import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { openaiClient } from "@/lib/ai/providers";
import {
  getAgentSessionByChatId,
  getChatById,
  incrementAgentSessionTokens,
  saveMessages,
  updateAgentSession,
} from "@/lib/db/queries";
import {
  ensureChatQuestions,
  formatQuestionsForPrompt,
} from "@/lib/interview/select-questions";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  messageId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { chatId } = await params;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

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
  if (!session.promptId || !session.promptVersion) {
    return Response.json(
      { error: "session_missing_prompt" },
      { status: 500 },
    );
  }

  const userMessageId = parsed.messageId ?? generateUUID();
  await saveMessages({
    messages: [
      {
        chatId,
        id: userMessageId,
        role: "user",
        parts: [{ type: "text", text: parsed.text }],
        attachments: [],
        createdAt: new Date(),
      },
    ],
  });

  const selectedQuestions = await ensureChatQuestions(chatId);
  const questionsBlock = formatQuestionsForPrompt(selectedQuestions);

  let response: Awaited<ReturnType<typeof openaiClient.responses.create>>;
  try {
    response = await openaiClient.responses.create({
      prompt: {
        id: session.promptId,
        version: session.promptVersion,
        variables: { questions: questionsBlock },
      },
      input: parsed.text,
      text: {
        format: {
          type: "text",
        },
      },
      reasoning: {},
      max_output_tokens: 2048,
      store: true,
      ...(session.responseId
        ? { previous_response_id: session.responseId }
        : {}),
    });
  } catch (error) {
    console.error("agent turn failed:", error);
    return Response.json({ error: "turn_failed" }, { status: 500 });
  }

  const assistantText = response.output_text ?? "";
  const assistantMessageId = generateUUID();

  await saveMessages({
    messages: [
      {
        chatId,
        id: assistantMessageId,
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
    ...(session.modelReported || !response.model
      ? {}
      : { modelReported: response.model }),
  });
  await incrementAgentSessionTokens({
    id: session.id,
    by: response.usage?.total_tokens ?? 0,
  });

  return Response.json({
    assistantMessage: {
      id: assistantMessageId,
      role: "assistant",
      parts: [{ type: "text", text: assistantText }],
    },
    responseId: response.id,
  });
}
