import { requireAgentAuth } from "@/lib/agent-auth";
import { openaiClient } from "@/lib/ai/providers";
import {
  getAgentSessionByChatId,
  getChatById,
  getMessagesByChatId,
  incrementAgentSessionTokens,
  saveMessages,
  updateAgentSession,
} from "@/lib/db/queries";
import {
  ensureChatQuestions,
  formatQuestionsForPrompt,
} from "@/lib/interview/select-questions";
import { generateUUID } from "@/lib/utils";

const MODEL_QUESTION =
  "Before we wrap up — for our records, can you tell me which OpenAI model is running this conversation? Just the model name and version if known.";

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

  // Idempotent: don't duplicate the model-ask exchange on retries.
  if (!session.completedAt && session.promptId && session.promptVersion) {
    try {
      const userMessageId = generateUUID();
      await saveMessages({
        messages: [
          {
            chatId,
            id: userMessageId,
            role: "user",
            parts: [{ type: "text", text: MODEL_QUESTION }],
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });

      const selectedQuestions = await ensureChatQuestions(chatId);
      const questionsBlock = formatQuestionsForPrompt(selectedQuestions);

      const response = await openaiClient.responses.create({
        prompt: {
          id: session.promptId,
          version: session.promptVersion,
          variables: { questions: questionsBlock },
        },
        input: MODEL_QUESTION,
        text: { format: { type: "text" } },
        reasoning: {},
        max_output_tokens: 256,
        store: true,
        ...(session.responseId
          ? { previous_response_id: session.responseId }
          : {}),
      });

      const assistantText = response.output_text ?? "";
      await saveMessages({
        messages: [
          {
            chatId,
            id: generateUUID(),
            role: "assistant",
            parts: [{ type: "text", text: assistantText }],
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });

      await updateAgentSession({
        id: session.id,
        responseId: response.id,
        ...(response.model ? { modelReported: response.model } : {}),
        ...(assistantText ? { modelSelfDeclared: assistantText } : {}),
      });
      await incrementAgentSessionTokens({
        id: session.id,
        by: response.usage?.total_tokens ?? 0,
      });
    } catch (error) {
      console.error("complete: model-ask failed; completing anyway:", error);
    }
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
