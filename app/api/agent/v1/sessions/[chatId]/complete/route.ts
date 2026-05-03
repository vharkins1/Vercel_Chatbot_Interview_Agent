import { requireAgentAuth } from "@/lib/agent-auth";
import {
  getAgentSessionByChatId,
  getChatById,
  getMessagesByChatId,
  updateAgentSession,
} from "@/lib/db/queries";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  const { chatId } = await params;

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.partnerAgentId !== auth.partnerAgentId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }

  await updateAgentSession({ id: session.id, completedAt: new Date() });

  const [refreshed, messages] = await Promise.all([
    getAgentSessionByChatId({ chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  return Response.json({
    chatId,
    agentSession: refreshed,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    })),
  });
}
