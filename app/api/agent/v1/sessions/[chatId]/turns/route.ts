import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { openaiClient } from "@/lib/ai/providers";
import {
  getAgentSessionByChatId,
  getChatById,
  saveMessages,
  updateAgentSession,
} from "@/lib/db/queries";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 60;

const STUDY_MODEL = process.env.STUDY_MODEL ?? "gpt-4o-mini";

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  messageId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = requireAgentAuth(request);
  if (!auth.ok) return auth.response;

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
  if (chat.userId !== auth.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await getAgentSessionByChatId({ chatId });
  if (!session) {
    return Response.json({ error: "no_agent_session" }, { status: 404 });
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

  let response;
  try {
    response = await openaiClient.responses.create({
      model: STUDY_MODEL,
      input: parsed.text,
      ...(session.instructions && !session.responseId
        ? { instructions: session.instructions }
        : {}),
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

  await updateAgentSession({ id: session.id, responseId: response.id });

  return Response.json({
    assistantMessage: {
      id: assistantMessageId,
      role: "assistant",
      parts: [{ type: "text", text: assistantText }],
    },
    responseId: response.id,
  });
}
