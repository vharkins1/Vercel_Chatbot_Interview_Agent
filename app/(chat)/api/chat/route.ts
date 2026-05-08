import { ipAddress } from "@vercel/functions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { openaiClient } from "@/lib/ai/providers";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  userExists,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import {
  ensureChatQuestions,
  formatQuestionsForPrompt,
} from "@/lib/interview/select-questions";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const POSITIVE_PROMPT_ID =
  process.env.OPENAI_POSITIVE_PROMPT_ID ??
  "pmpt_69f7b7d4852c8194823ae04758ff45b90036c2b9bf3e67fd";
const POSITIVE_PROMPT_VERSION =
  process.env.OPENAI_POSITIVE_PROMPT_VERSION ?? "1";

type ResponsesMessageInput = {
  role: "user" | "assistant";
  content: string;
  type: "message";
};

function getTextFromMessage(message: ChatMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toResponsesInput(messages: ChatMessage[]): ResponsesMessageInput[] {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: getTextFromMessage(message),
      type: "message" as const,
    }))
    .filter((message) => message.content.length > 0);
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, selectedVisibilityType } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    if (!(await userExists(session.user.id))) {
      const res = new ChatbotError(
        "unauthorized:chat",
        "stale_session"
      ).toResponse();
      // Cookie was issued for a User row that has since been deleted (e.g. by
      // db:wipe-chat-data). Clear both possible NextAuth session cookies so
      // the next request gets redirected through /api/auth/guest and a fresh
      // User row is created.
      res.headers.append(
        "Set-Cookie",
        "authjs.session-token=; Path=/; Max-Age=0; SameSite=Lax"
      );
      res.headers.append(
        "Set-Cookie",
        "__Secure-authjs.session-token=; Path=/; Max-Age=0; Secure; SameSite=Lax"
      );
      return res;
    }

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
    }

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const uiMessages = [
      ...convertToUIMessages(messagesFromDb),
      ...(message ? [message as ChatMessage] : []),
    ];
    const responseInput = toResponsesInput(uiMessages);

    const selectedQuestions = await ensureChatQuestions(id);
    const questionsBlock = formatQuestionsForPrompt(selectedQuestions);

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const response = await openaiClient.responses.create({
          prompt: {
            id: POSITIVE_PROMPT_ID,
            version: POSITIVE_PROMPT_VERSION,
            variables: { questions: questionsBlock },
          },
          input: responseInput,
          text: {
            format: {
              type: "text",
            },
          },
          reasoning: {},
          max_output_tokens: 2048,
          store: true,
        });

        const assistantText = response.output_text ?? "";
        const assistantMessageId = generateUUID();
        const textPartId = generateUUID();

        dataStream.write({ type: "start", messageId: assistantMessageId });
        dataStream.write({ type: "text-start", id: textPartId });
        dataStream.write({
          type: "text-delta",
          id: textPartId,
          delta: assistantText,
        });
        dataStream.write({ type: "text-end", id: textPartId });
        dataStream.write({ type: "finish", finishReason: "stop" });

        await saveMessages({
          messages: [
            {
              chatId: id,
              id: assistantMessageId,
              role: "assistant",
              parts: [{ type: "text", text: assistantText }],
              attachments: [],
              createdAt: new Date(),
            },
          ],
        });
      },
      generateId: generateUUID,
      onError: (error) => {
        console.error("Hosted Responses prompt failed:", error);
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
