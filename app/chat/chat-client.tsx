"use client";

import { ArrowUpIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

// The session-creation endpoint normally returns only `{ chatId }`. When the
// server-side UNBLIND_FRONTEND flag is set (staff/testing only), it also
// returns the blinded condition code and its descriptive label so we can show
// a debug badge. Both are optional — absent in the blinded production path.
type Session = {
  chatId: string;
  condition?: "A" | "B" | "C";
  conditionLabel?: string;
  // Present when the server matched an in-progress interview for this
  // participant (same Qualtrics ResponseID) instead of creating a new one —
  // a reload or back-button on the reusable entry link.
  resumed?: boolean;
  messages?: Array<{ id: string; role: "user" | "assistant"; text: string }>;
};

const INTERVIEW_START_PROMPT =
  "Please start the interview by greeting the candidate and asking the first question.";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invitation: "This invitation link is invalid.",
  invitation_expired: "This invitation link has expired.",
  already_redeemed: "This invitation has already been used.",
  already_completed:
    "You have already completed this interview. Please return to the survey tab to finish the study.",
  participant_api_disabled:
    "The interview is not available right now. Please try again later.",
};

export function ChatClient({
  invitationToken,
  qualtricsResponseId,
  sessionEndpoint = "/api/participant/v1/sessions",
  devPromptId,
  devPromptVersion,
}: {
  invitationToken: string;
  qualtricsResponseId?: string | null;
  sessionEndpoint?: string;
  devPromptId?: string;
  devPromptVersion?: string;
}) {
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [followupUrl, setFollowupUrl] = useState<string | null>(null);
  const [surveyUnlocked, setSurveyUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootStartedRef = useRef(false);
  const seedStartedRef = useRef(false);

  // Session creation (which redeems the one-shot invitation token) waits for
  // the participant to press Start on the splash screen, so merely opening
  // the link never burns the invitation.
  useEffect(() => {
    if (!started || bootStartedRef.current) {
      return;
    }
    bootStartedRef.current = true;
    (async () => {
      try {
        const res = await fetch(sessionEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invitationToken,
            ...(qualtricsResponseId ? { qualtricsResponseId } : {}),
            ...(devPromptId ? { devPromptId } : {}),
            ...(devPromptVersion ? { devPromptVersion } : {}),
          }),
        });
        if (!res.ok) {
          let reason = "invalid_invitation";
          try {
            const body = (await res.json()) as { error?: string };
            reason = body.error ?? reason;
          } catch {
            // ignore
          }
          setBootError(
            ERROR_MESSAGES[reason] ??
              "Something went wrong. Please contact the study team."
          );
          return;
        }
        const body = (await res.json()) as Session;
        // Resuming: replay what was already said. The hidden seed turn is
        // persisted like any other user message, so drop it here — it is an
        // instruction to the interviewer, not something the participant wrote.
        if (body.resumed && body.messages?.length) {
          setMessages(
            body.messages.filter(
              (m) => !(m.role === "user" && m.text === INTERVIEW_START_PROMPT)
            )
          );
          seedStartedRef.current = true;
        }
        setSession(body);
      } catch (_) {
        setBootError("Network error. Please reload the page.");
      }
    })();
  }, [started, invitationToken, qualtricsResponseId, sessionEndpoint, devPromptId, devPromptVersion]);

  // Close out the session and fetch the survey handoff link. On the normal
  // path the turns response already carries both, so this is belt-and-braces;
  // it is the primary source for the fallback button and for retries.
  const completeSession = useCallback(async () => {
    if (!session) {
      return null;
    }
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/participant/v1/sessions/${session.chatId}/complete`,
        { method: "POST" }
      );
      if (!res.ok) {
        setError("Could not finalize the interview. Please try again.");
        return null;
      }
      const body = (await res.json()) as { followupUrl: string | null };
      setFollowupUrl((prev) => body.followupUrl ?? prev);
      return body.followupUrl;
    } catch (_) {
      setError("Network error. Please try again.");
      return null;
    } finally {
      setCompleting(false);
    }
  }, [session]);

  // Fallback path: the participant gave up on a looping interviewer and used
  // the unlocked survey link. Close the session, then hand off.
  const leaveForSurvey = useCallback(async () => {
    const url = (await completeSession()) ?? followupUrl;
    setEnded(true);
    if (url) {
      window.location.href = url;
    }
  }, [completeSession, followupUrl]);

  const sendTurn = useCallback(
    async (text: string, options?: { hideUserMessage?: boolean }) => {
      if (!session) {
        return;
      }
      setPending(true);
      setError(null);
      if (!options?.hideUserMessage) {
        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text,
        };
        setMessages((prev) => [...prev, userMsg]);
      }
      try {
        const res = await fetch(
          `/api/participant/v1/sessions/${session.chatId}/turns`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          }
        );
        if (!res.ok) {
          setError("Something went wrong sending that message.");
          return;
        }
        const body = (await res.json()) as {
          assistantMessage: { id: string; text: string };
          ended?: boolean;
          surveyUnlocked?: boolean;
          followupUrl?: string | null;
        };
        setMessages((prev) => [
          ...prev,
          {
            id: body.assistantMessage.id,
            role: "assistant",
            text: body.assistantMessage.text,
          },
        ]);
        // The server already closed the session and built the link when it
        // flagged the end, so the link is in hand before /complete resolves.
        if (body.followupUrl) {
          setFollowupUrl(body.followupUrl);
        }
        if (body.surveyUnlocked) {
          setSurveyUnlocked(true);
        }
        if (body.ended) {
          setEnded(true);
          completeSession().catch((err) => {
            console.error(err);
          });
        }
      } catch (_) {
        setError("Network error. Please try again.");
      } finally {
        setPending(false);
      }
    },
    [session, completeSession]
  );

  useEffect(() => {
    if (!session || seedStartedRef.current) {
      return;
    }
    seedStartedRef.current = true;
    sendTurn(INTERVIEW_START_PROMPT, { hideUserMessage: true });
  }, [session, sendTurn]);

  const handleSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text || pending || ended || !session) {
      return;
    }
    setDraft("");
    await sendTurn(text);
  }, [draft, pending, ended, session, sendTurn]);

  if (!started) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="font-semibold text-2xl">Research Interview</h1>
        <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
          You are about to begin a short interview, followed immediately by a
          brief survey. Please complete the interview and the survey in one
          sitting; your session cannot be paused and resumed later.
        </p>
        <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
          Feel free to speak your answers instead of typing them, using your
          device's built-in dictation: the microphone key on a phone or tablet
          keyboard, or your computer's dictation shortcut (Windows: Win + H;
          Mac: the microphone key, or System Settings → Keyboard → Dictation).
          Dictation is handled entirely by your own device — we receive only the
          text you send.
        </p>
        <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
          Your responses and the timestamps of each turn are recorded for
          research purposes. We do not store the IP address you connect from:
          only a one-way hash of it, which cannot be turned back into your IP.
        </p>
        <Button className="mt-8" onClick={() => setStarted(true)} size="lg">
          Start
        </Button>
      </main>
    );
  }

  if (bootError) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-16 text-center">
        <h1 className="font-semibold text-2xl">Unable to start interview</h1>
        <p className="mt-3 text-muted-foreground text-sm">{bootError}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-16 text-center">
        <p className="text-muted-foreground text-sm">Starting interview…</p>
      </main>
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="border-b px-6 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-medium text-sm">Lab Interview</h1>
            {session.conditionLabel ? (
              <span className="mt-1 inline-block rounded border border-amber-500/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                Unblinded · {session.condition} - {session.conditionLabel}
              </span>
            ) : null}
          </div>
        </div>
        <p className="mx-auto mt-2 w-full max-w-3xl text-[11px] text-muted-foreground">
          Your responses and the timestamps of each turn are recorded for
          research purposes. We do not store the IP address you connect from:
          only a one-way hash of it, which cannot be turned back into your IP.
        </p>
      </header>

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-2 py-6 md:gap-7 md:px-4">
          {messages.length === 0 && !pending ? (
            <p className="text-muted-foreground text-sm">Connecting…</p>
          ) : null}
          {messages.map((m) => (
            <Message from={m.role} key={m.id}>
              <MessageContent
                className={cn(
                  "text-[13px] leading-[1.65]",
                  m.role === "user" &&
                    "w-fit max-w-[min(80%,56ch)] self-end overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-sm"
                )}
              >
                {m.role === "assistant" ? (
                  <MessageResponse>{m.text}</MessageResponse>
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}
              </MessageContent>
            </Message>
          ))}
          {pending ? (
            <p className="text-muted-foreground text-sm italic">Thinking…</p>
          ) : null}
          {ended ? (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium">
                Interview complete. Thank you for participating.
              </p>
              <p className="mt-1 text-muted-foreground">
                Please continue to the short follow-up survey now, in the same
                sitting.
              </p>
              {followupUrl ? (
                <Button asChild className="mt-3" size="sm">
                  <a href={followupUrl}>Continue to survey</a>
                </Button>
              ) : null}
              {!followupUrl && completing ? (
                <p className="mt-3 text-muted-foreground text-sm italic">
                  Preparing survey link…
                </p>
              ) : null}
              {!(followupUrl || completing) && error ? (
                <Button
                  className="mt-3"
                  onClick={() => {
                    completeSession().catch((err) => {
                      console.error(err);
                    });
                  }}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {ended ? null : (
        <footer className="border-t bg-background px-6 py-3">
          {surveyUnlocked ? (
            <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end">
              <Button
                className="h-auto px-1 py-0.5 text-[11px] text-muted-foreground"
                disabled={completing}
                onClick={() => {
                  leaveForSurvey().catch((err) => {
                    console.error(err);
                  });
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Finished? Continue to the survey
              </Button>
            </div>
          ) : null}
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit().catch((err) => {
                console.error(err);
              });
            }}
          >
            <Textarea
              className="min-h-[44px] resize-none"
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit().catch((err) => {
                    console.error(err);
                  });
                }
              }}
              placeholder="Type your reply…"
              rows={2}
              value={draft}
            />
            <Button
              disabled={pending || draft.trim().length === 0}
              size="icon"
              type="submit"
            >
              <ArrowUpIcon className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </footer>
      )}
    </div>
  );
}
