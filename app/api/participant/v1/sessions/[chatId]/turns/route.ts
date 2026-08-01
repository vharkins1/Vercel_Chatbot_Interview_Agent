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
  completeInterviewSession,
  executeTurn,
} from "@/lib/study/session-service";

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
});

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

  const result = await executeTurn({
    chatId,
    text: parsed.text,
    ipHash: hashIp(ip),
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
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
    looksLikeEnd(result.assistantText) || llmTurns >= MAX_PARTICIPANT_TURNS;

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
      qualtricsResponseId:
        completion?.agentSession?.qualtricsResponseId ?? null,
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
