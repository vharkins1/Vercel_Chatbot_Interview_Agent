import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  createStudySession,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getStudySessionByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
  updateStudySession,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import {
  buildStudyPrompt,
  getNextState,
  getQuestion,
  getTopicName,
  MAX_REATTEMPTS,
  QUESTIONS_PER_TOPIC,
  resolveTopicOrder,
  type Condition,
  type StudyPhase,
} from "@/lib/study/protocol";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

/** Find the message index where the current topic's conversation starts */
function findTopicStartIndex(messages: ChatMessage[], topicIndex: number, questionsPerTopic: number): number {
  // Each topic has: intro/question messages + user answers + feedback
  // Approximate: count backwards from end based on expected message pairs
  // A safer approach: look for the topic's first question in the messages
  // For now, use a simple heuristic: send last N messages where N covers current topic
  const messagesPerTopic = questionsPerTopic * 2 + 2; // Q+A pairs + intro + feedback
  const startFromEnd = messagesPerTopic * (topicIndex > 0 ? 1 : topicIndex + 1);
  return Math.max(0, messages.length - startFromEnd);
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType, studyCondition, studyOptions } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

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
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

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

    // ── Study Branch ─────────────────────────────────────────────
    // If this is the first message and a studyCondition was provided,
    // create the study session now (the Chat row was just created above).
    if (studyCondition && message?.role === "user") {
      const existing = await getStudySessionByChatId({ chatId: id });
      if (!existing) {
        const topicOrder = resolveTopicOrder();
        await createStudySession({
          chatId: id,
          userId: session.user.id,
          condition: studyCondition,
          topicOrder,
        });
      }
    }

    const studySession = await getStudySessionByChatId({ chatId: id });

    if (studySession && studySession.phase !== "complete" && message?.role === "user") {
      const topicOrder = resolveTopicOrder(studySession.topicOrder as number[] | undefined);
      const useSummarization = studyOptions?.useSummarization ?? false;

      const currentState = {
        phase: studySession.phase as StudyPhase,
        topicIndex: studySession.currentTopicIndex,
        questionIndex: studySession.currentQuestionIndex,
      };

      // ── Re-ask check ──────────────────────────────────────────
      // If we're in questioning phase, check if the user actually answered.
      // If not and retries remain, stay on the same question.
      let shouldReask = false;
      let exhaustedReasks = false;
      if (currentState.phase === "questioning") {
        const currentQuestion = await getQuestion(
          currentState.topicIndex,
          currentState.questionIndex,
          topicOrder,
        );
        const userText = message.parts
          ?.filter((p: { type: string }) => p.type === "text")
          .map((p: { type: string; text?: string }) => p.text ?? "")
          .join(" ");

        if (currentQuestion && userText) {
          const retryCount = studySession.retryCount ?? 0;
          if (retryCount >= MAX_REATTEMPTS) {
            // Retries exhausted — we'll move on but flag it so the
            // next question doesn't praise the non-answer
            exhaustedReasks = true;
          } else if (retryCount < MAX_REATTEMPTS) {
            const studyModel = process.env.STUDY_MODEL ?? "gpt-4o-mini";
            const { text: verdict } = await generateText({
              model: getLanguageModel(studyModel),
              system: `You are a strict judge for a research study. You determine whether a participant has provided a meaningful, substantive response to an interview question. Reply with ONLY "yes" or "no".

Reply "yes" ONLY if the response clearly and directly addresses the question with specific personal content — a real opinion, experience, feeling, or detail.

Reply "no" if the response:
- Is vague, generic, or lacks specificity (e.g., "it's fine", "I like stuff", "not much")
- Deflects or avoids engaging (e.g., "I don't know", "hard to say", "no comment", "pass")
- Is too short or shallow to extract meaningful data from
- Answers a different question than the one asked
- Is a question back to the interviewer
- Is nonsensical, joking, or off-topic
- Gives a surface-level answer without any personal reflection or detail

Be strict. This is a research study — we need substantive self-disclosure, not token responses. When in doubt, say "no".`,
              prompt: `Question: "${currentQuestion.text}"\n\nResponse: "${userText}"\n\nIs this a substantive, meaningful answer to the question?`,
            });

            if (verdict.trim().toLowerCase().startsWith("no")) {
              shouldReask = true;
              await updateStudySession({
                id: studySession.id,
                retryCount: retryCount + 1,
              });
            }
          }
        }
      }

      // If re-asking, stay on current state; otherwise advance
      const nextState = shouldReask ? currentState : getNextState(currentState);

      // Reset retryCount when advancing to a new question
      if (!shouldReask && currentState.phase === "questioning") {
        await updateStudySession({ id: studySession.id, retryCount: 0 });
      }

      // Gather topic answers for feedback phase
      let topicAnswers: string[] | undefined;
      if (nextState.phase === "feedback") {
        const allMessages = await getMessagesByChatId({ id });
        const userMsgs = allMessages
          .filter((m) => m.role === "user")
          .slice(-QUESTIONS_PER_TOPIC);
        topicAnswers = userMsgs.map((m) => {
          const parts = m.parts as Array<{ type: string; text?: string }>;
          return parts
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(" ");
        });
      }

      // Get previous summaries for context
      const previousSummary = useSummarization
        ? ((studySession.topicSummaries as string[]) ?? []).join("\n\n")
        : undefined;

      // Build study system prompt using the template engine
      const studyPrompt = await buildStudyPrompt({
        phase: nextState.phase,
        condition: studySession.condition as Condition,
        topicIndex: nextState.topicIndex,
        questionIndex: nextState.questionIndex,
        topicOrder,
        topicAnswers,
        previousSummary: previousSummary || undefined,
        isReask: shouldReask,
        exhaustedReasks,
      });

      // Update session in DB
      await updateStudySession({
        id: studySession.id,
        phase: nextState.phase,
        currentTopicIndex: nextState.topicIndex,
        currentQuestionIndex: nextState.questionIndex,
        ...(nextState.phase === "complete" ? { completedAt: new Date() } : {}),
      });

      // --- Build context-windowed messages for the API ---
      // Only send current topic's messages, not the full history
      let contextMessages: typeof uiMessages;
      if (nextState.phase === "questioning" || nextState.phase === "feedback") {
        // Find where the current topic started (after the last feedback or start)
        const topicStartIndex = findTopicStartIndex(uiMessages, nextState.topicIndex, QUESTIONS_PER_TOPIC);
        contextMessages = uiMessages.slice(topicStartIndex);
      } else {
        contextMessages = uiMessages;
      }

      const studyModel = process.env.STUDY_MODEL ?? "gpt-4o-mini";

      const contextModelMessages = await convertToModelMessages(contextMessages);

      const studyStream = createUIMessageStream({
        execute: async ({ writer: dataStream }) => {
          const result = streamText({
            model: getLanguageModel(studyModel),
            system: studyPrompt,
            messages: contextModelMessages,
            experimental_activeTools: [],
          });

          dataStream.merge(result.toUIMessageStream());

          // Emit study state for the client
          dataStream.write({ type: "data-study-state", data: JSON.stringify(nextState) });
        },
        generateId: generateUUID,
        onFinish: async ({ messages: finishedMessages }) => {
          if (finishedMessages.length > 0) {
            await saveMessages({
              messages: finishedMessages.map((m) => ({
                id: m.id,
                role: m.role,
                parts: m.parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              })),
            });
          }
        },
        onError: (error) => {
          console.error("Study stream error:", error);
          return "Oops, an error occurred!";
        },
      });

      return createUIMessageStreamResponse({ stream: studyStream });
    }
    // ── End Study Branch ─────────────────────────────────────────

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const modelMessages = await convertToModelMessages(uiMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        const result = streamText({
          model: getLanguageModel(chatModel),
          system: systemPrompt({ requestHints, supportsTools }),
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          tools: {
            getWeather,
            createDocument: createDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            editDocument: editDocument({ dataStream, session }),
            updateDocument: updateDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
              modelId: chatModel,
            }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isReasoningModel })
        );

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
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
