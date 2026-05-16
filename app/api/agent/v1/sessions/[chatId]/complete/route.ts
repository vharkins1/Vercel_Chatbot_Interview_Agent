import { requireAgentAuth } from "@/lib/agent-auth";
import { getChatById } from "@/lib/db/queries";
import { completeInterviewSession } from "@/lib/study/session-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { chatId } = await params;

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.partnerAgentId !== auth.partnerAgentId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await completeInterviewSession({ chatId });
  if (!result) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
  }

  return Response.json({
    chatId,
    agentSession: result.agentSession,
    messages: result.messages,
  });
}
