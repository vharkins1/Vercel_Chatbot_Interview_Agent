import { cookies } from "next/headers";
import {
  PARTICIPANT_COOKIE,
  verifyParticipantSession,
} from "@/lib/participant-auth";
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

  // Carry the participant counter + chatId onto the Qualtrics follow-up link so
  // the human's browser-side survey can capture them as embedded data (Qualtrics
  // auto-captures matching URL query params when the fields are declared in the
  // Survey Flow). Mirrors the agent path, which injects the same keys at submit.
  const followupUrl = buildFollowupUrl({
    base: process.env.QUALTRICS_FOLLOWUP_URL ?? null,
    chatId,
    seq: result.agentSession?.seq ?? null,
  });

  return Response.json({ ok: true, followupUrl });
}

function buildFollowupUrl({
  base,
  chatId,
  seq,
}: {
  base: string | null;
  chatId: string;
  seq: number | null;
}): string | null {
  if (!base) {
    return null;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("chat_id", chatId);
    if (seq != null) {
      url.searchParams.set("participant_seq", String(seq));
    }
    return url.toString();
  } catch {
    // Non-absolute or malformed URL: leave it untouched rather than drop it.
    return base;
  }
}
