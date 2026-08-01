import { cookies } from "next/headers";
import {
  PARTICIPANT_COOKIE,
  verifyParticipantSession,
} from "@/lib/participant-auth";
import { buildFollowupUrl } from "@/lib/study/qualtrics-followup";
import { completeInterviewSession } from "@/lib/study/session-service";

export async function POST(
  _request: Request,
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

  const result = await completeInterviewSession({ chatId });
  if (!result) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }

  // Same link the turns route appends to the interviewer's closing message —
  // see lib/study/qualtrics-followup.ts. Reachable here as well so the
  // fallback button and any retry produce an identical URL.
  const followupUrl = buildFollowupUrl({
    chatId,
    seq: result.agentSession?.seq ?? null,
    completionCode: result.agentSession?.completionCode ?? null,
    qualtricsResponseId: result.agentSession?.qualtricsResponseId ?? null,
  });

  return Response.json({ ok: true, followupUrl });
}
