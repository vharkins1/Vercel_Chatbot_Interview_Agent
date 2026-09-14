import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { agentSession, chat, message } from "@/lib/db/schema";
import {
  PARTICIPANT_COOKIE,
  type ParticipantSessionClaims,
  verifyParticipantSession,
} from "@/lib/participant-auth";
import {
  formatConversationTranscript,
  formatTranscriptFilename,
  transcriptDate,
} from "@/lib/transcript";

const ChatIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const cookieStore = await cookies();
  const cookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
  if (!cookie) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let claims: ParticipantSessionClaims;
  try {
    claims = await verifyParticipantSession(cookie);
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (claims.chatId !== chatId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!ChatIdSchema.safeParse(chatId).success) {
    return Response.json({ error: "invalid_chat_id" }, { status: 400 });
  }

  const [[conversationChat], [session]] = await Promise.all([
    db
      .select({
        id: chat.id,
        createdAt: chat.createdAt,
        partnerAgentId: chat.partnerAgentId,
      })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1),
    db
      .select({
        createdAt: agentSession.createdAt,
        condition: agentSession.condition,
        promptId: agentSession.promptId,
        promptVersion: agentSession.promptVersion,
        interviewerModel: agentSession.interviewerModel,
      })
      .from(agentSession)
      .where(eq(agentSession.chatId, chatId))
      .limit(1),
  ]);
  if (!(conversationChat && session)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (session.condition !== "DEV") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const messages = await db
    .select({
      id: message.id,
      createdAt: message.createdAt,
      role: message.role,
      parts: message.parts,
    })
    .from(message)
    .where(eq(message.chatId, chatId))
    .orderBy(asc(message.createdAt), asc(message.id));
  const conversation = {
    chatId: conversationChat.id,
    chatCreatedAt: conversationChat.createdAt,
    partnerAgentId: conversationChat.partnerAgentId,
    sessionCreatedAt: session.createdAt,
    condition: session.condition,
    promptId: session.promptId,
    promptVersion: session.promptVersion,
    interviewerModel: session.interviewerModel,
  };
  const transcript = formatConversationTranscript({ conversation, messages });
  const filename = formatTranscriptFilename(
    transcriptDate(conversation),
    conversation.chatId,
    "txt"
  );

  return new Response(transcript, {
    status: 200,
    headers: {
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
