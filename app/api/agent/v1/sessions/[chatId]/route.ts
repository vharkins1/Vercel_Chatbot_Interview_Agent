import { requireAgentAuth } from "@/lib/agent-auth";
import {
  getChatById,
  getMessagesByChatId,
  getStudySessionByChatId,
} from "@/lib/db/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  const { chatId } = await params;

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.userId !== auth.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const [studySession, messages] = await Promise.all([
    getStudySessionByChatId({ chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  return Response.json({
    chatId,
    studySession,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    })),
  });
}
