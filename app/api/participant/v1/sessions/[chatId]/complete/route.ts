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

  return Response.json({
    ok: true,
    followupUrl: process.env.QUALTRICS_FOLLOWUP_URL ?? null,
  });
}
