import { cookies } from "next/headers";
import { z } from "zod";
import { countMessagesByChatId, updateMessageText } from "@/lib/db/queries";
import {
  PARTICIPANT_COOKIE,
  verifyParticipantSession,
} from "@/lib/participant-auth";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import {
  looksLikeEnd,
  MAX_PARTICIPANT_TURNS,
  SURVEY_UNLOCK_AFTER_LLM_TURNS,
} from "@/lib/study/interview-end";
import {
  buildFollowupUrl,
  formatFollowupLinkForMessage,
} from "@/lib/study/qualtrics-followup";
import {
  getRuntimePrompt,
  RUNTIME_PROMPT_KEYS,
} from "@/lib/study/runtime-prompts";
import {
  completeInterviewSession,
  executeTurn,
} from "@/lib/study/session-service";

export const maxDuration = 60;

const bodySchema = z
  .union([
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("start") }),
      z.object({
        kind: z.literal("message"),
        text: z.string().min(1).max(8000),
      }),
    ]),
    // Accept the pre-deploy browser payload during a rolling Vercel release.
    z.object({ text: z.string().min(1).max(8000) }),
  ])
  .transform((body) =>
    "kind" in body ? body : { kind: "message" as const, text: body.text }
  );

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;

  const cookieStore = await cookies();
  const cookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
  if (!cookie) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifyParticipantSession>>;
  try {
    claims = await verifyParticipantSession(cookie);
  } catch (_) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (claims.chatId !== chatId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const ip = getRequestIp(request);

  let retryPersistedStart = false;
  if (parsed.kind === "start") {
    const [userTurns, assistantTurns] = await Promise.all([
      countMessagesByChatId({ id: chatId, role: "user" }),
      countMessagesByChatId({ id: chatId, role: "assistant" }),
    ]);
    retryPersistedStart = userTurns === 1 && assistantTurns === 0;
    if (assistantTurns > 0 || userTurns > 1) {
      return Response.json(
        { error: "interview_already_started" },
        { status: 409 }
      );
    }
  }

  const text =
    parsed.kind === "start"
      ? await getRuntimePrompt(RUNTIME_PROMPT_KEYS.interviewStart)
      : parsed.text;

  const result = await executeTurn({
    chatId,
    text,
    ipHash: hashIp(ip),
    persistUserMessage: !retryPersistedStart,
  });
  if (!result.ok) {
    const body: { error: string; details?: string } = { error: result.error };
    if ("details" in result && result.details) {
      body.details = result.details;
    }
    return Response.json(body, { status: result.status });
  }

  // The server decides when the interview is over: either the interviewer
  // emitted the fixed closing question (the normal path) or the hard turn cap
  // was hit. Interviewer replies are counted, not participant+interviewer
  // exchanges — one OpenAI call is one turn. The first reply answers the
  // hidden seed turn, so this count is exactly the number of LLM calls made.
  const llmTurns = await countMessagesByChatId({
    id: chatId,
    role: "assistant",
  });
  const ended =
    (await looksLikeEnd(result.assistantText)) ||
    llmTurns >= MAX_PARTICIPANT_TURNS;

  // Once the interview has run long enough that it should already have
  // reached the closing question, the UI reveals a subtle fallback link so a
  // looping interviewer cannot strand the participant short of the survey.
  const surveyUnlocked = llmTurns >= SURVEY_UNLOCK_AFTER_LLM_TURNS;

  let assistantText = result.assistantText;
  let followupUrl: string | null = null;

  if (ended) {
    // Close the session here rather than waiting on a second round trip: this
    // mints the completionCode the follow-up link is keyed on, and it means a
    // participant who never gets to call /complete still receives the link.
    // /complete stays idempotent and is still called by the client.
    const completion = await completeInterviewSession({ chatId });
    followupUrl = buildFollowupUrl({
      chatId,
      seq: completion?.agentSession?.seq ?? null,
      completionCode: completion?.agentSession?.completionCode ?? null,
      studyId: completion?.agentSession?.studyId ?? null,
      id: completion?.agentSession?.sonaId ?? null,
    });

    if (followupUrl) {
      // The closing question ends at a colon and the interviewer is told not
      // to invent a URL, so the link is appended here with the per-session
      // join keys already attached. Persist the appended form too, so the
      // exported transcript matches what the participant saw.
      assistantText += formatFollowupLinkForMessage(followupUrl);
      await updateMessageText({
        id: result.assistantMessageId,
        text: assistantText,
      });
    }
  }

  return Response.json({
    assistantMessage: {
      id: result.assistantMessageId,
      role: "assistant",
      text: assistantText,
    },
    model: result.model,
    ended,
    surveyUnlocked,
    followupUrl,
  });
}
