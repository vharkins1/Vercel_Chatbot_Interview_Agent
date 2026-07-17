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

  // Carry the study join keys onto the Qualtrics follow-up link so the
  // human's browser-side survey captures them as embedded data (Qualtrics
  // auto-captures matching URL query params when the fields are declared in
  // the Survey Flow — declare completion_code, chat_id, and participant_seq
  // there or Qualtrics silently drops them; scripts/ensure-survey-fields.ts
  // automates the declaration). Mirrors the agent path, which injects the
  // same three keys at submit (see app/api/agent/v1/.../survey/route.ts).
  //
  // TODO: swap in QUALTRICS_FOLLOWUP_URL before launch — uncomment the env
  // line and delete the example line below it. Everything else is wired.
  const followupUrl = buildFollowupUrl({
    // base: process.env.QUALTRICS_FOLLOWUP_URL ?? null,
    base: process.env.QUALTRICS_FOLLOWUP_URL ?? null,
    chatId,
    seq: result.agentSession?.seq ?? null,
    completionCode: result.agentSession?.completionCode ?? null,
  });

  return Response.json({ ok: true, followupUrl });
}

// Placeholder Qualtrics link so the handoff renders end-to-end with the real
// query-param shape before the production survey URL is dropped in.
const EXAMPLE_FOLLOWUP_URL =
  "https://qualtrics.example.com/jfe/form/SV_EXAMPLE";

function buildFollowupUrl({
  base,
  chatId,
  seq,
  completionCode,
}: {
  base: string | null;
  chatId: string;
  seq: number | null;
  completionCode: string | null;
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
    if (completionCode) {
      url.searchParams.set("completion_code", completionCode);
    }
    return url.toString();
  } catch {
    // Non-absolute or malformed URL: leave it untouched rather than drop it.
    return base;
  }
}
