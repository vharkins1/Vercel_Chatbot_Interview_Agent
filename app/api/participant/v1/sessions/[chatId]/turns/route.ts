import { cookies } from "next/headers";
import { z } from "zod";
import { countUserMessagesByChatId } from "@/lib/db/queries";
import {
  PARTICIPANT_COOKIE,
  verifyParticipantSession,
} from "@/lib/participant-auth";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import { looksLikeEnd, MAX_PARTICIPANT_TURNS } from "@/lib/study/interview-end";
import { executeTurn } from "@/lib/study/session-service";

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

  // The UI has no manual end control: the server decides when the interview
  // is over, either because the interviewer's reply reads as a close or
  // because the turn cap was hit. The client reacts by calling /complete.
  // The count includes the hidden seed turn, matching how agent sessions
  // count turns.
  const userTurns = await countUserMessagesByChatId({ id: chatId });
  const ended =
    looksLikeEnd(result.assistantText) || userTurns >= MAX_PARTICIPANT_TURNS;

  return Response.json({
    assistantMessage: {
      id: result.assistantMessageId,
      role: "assistant",
      text: result.assistantText,
    },
    model: result.model,
    ended,
  });
}
