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
};

const INTERVIEW_START_PROMPT =
  "Please start the interview by greeting the candidate and asking the first question.";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_invitation: "This invitation link is invalid.",
  invitation_expired: "This invitation link has expired.",
  already_redeemed: "This invitation has already been used.",
  participant_api_disabled:
    "The interview is not available right now. Please try again later.",
};

export function ChatClient({ invitationToken }: { invitationToken: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootStartedRef = useRef(false);

  useEffect(() => {
    if (bootStartedRef.current) {
      return;
    }
    bootStartedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/participant/v1/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invitationToken }),
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
        setSession(body);
      } catch (_) {
        setBootError("Network error. Please reload the page.");
      }
    })();
  }, [invitationToken]);

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
        };
        setMessages((prev) => [
          ...prev,
          {
            id: body.assistantMessage.id,
            role: "assistant",
            text: body.assistantMessage.text,
          },
        ]);
      } catch (_) {
        setError("Network error. Please try again.");
      } finally {
        setPending(false);
      }
    },
    [session]
  );

  const seedStartedRef = useRef(false);
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

  const handleEnd = useCallback(async () => {
    if (pending || !session) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/participant/v1/sessions/${session.chatId}/complete`,
        { method: "POST" }
      );
      if (!res.ok) {
        setError("Could not end the interview. Please try again.");
        return;
      }
      const body = (await res.json()) as { followupUrl: string | null };
      setEnded(true);
      if (body.followupUrl) {
        window.location.assign(body.followupUrl);
      }
    } catch (_) {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }, [session, pending]);

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
          <Button
            disabled={pending || ended}
            onClick={handleEnd}
            size="sm"
            variant="outline"
          >
            End interview
          </Button>
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
            <p className="text-muted-foreground text-sm">
              Interview ended. Thank you for participating.
            </p>
          ) : null}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <footer className="border-t bg-background px-6 py-3">
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
            disabled={pending || ended}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit().catch((err) => {
                  console.error(err);
                });
              }
            }}
            placeholder={ended ? "Interview ended" : "Type your reply…"}
            rows={2}
            value={draft}
          />
          <Button
            disabled={pending || ended || draft.trim().length === 0}
            size="icon"
            type="submit"
          >
            <ArrowUpIcon className="size-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </footer>
    </div>
  );
}
