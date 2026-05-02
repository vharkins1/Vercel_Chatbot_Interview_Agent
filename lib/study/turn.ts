import "server-only";
import {
  createStudySession,
  getChatById,
  getMessagesByChatId,
  getStudySessionByChatId,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";
import type { StudySession } from "@/lib/db/schema";
import { openaiClient } from "@/lib/ai/providers";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { formatQuestionsBlock, pickStudyPlan } from "@/lib/study/selection";
import { FEEDBACK_STYLES, type FeedbackStyle } from "@/lib/study/protocol";

const STUDY_PROMPT_ID = "pmpt_69cbdddfaf8c81978d8cef3154988ede0c3003a4ad0fa30a";
const STUDY_PROMPT_VERSION = process.env.STUDY_PROMPT_VERSION ?? "2";

export type StudyTextPart = { type: "text"; text: string };

export type StudyAssistantMessage = {
  id: string;
  role: "assistant";
  parts: StudyTextPart[];
};

export type StudyUserMessage = {
  id: string;
  role: "user";
  parts: StudyTextPart[];
};

export type RunStudyTurnInput = {
  chatId: string;
  userId: string;
  userMessage: StudyUserMessage;
  feedbackStyle?: FeedbackStyle;
  chatTitle?: string;
  /**
   * Set false when the caller has already persisted the user message
   * (e.g. the UI chat route saves it before branching). Default: true.
   */
  persistUserMessage?: boolean;
  /**
   * Set false when the caller has already ensured the Chat row exists
   * (e.g. the UI chat route creates it before branching). Default: true.
   */
  ensureChat?: boolean;
};

export type RunStudyTurnResult = {
  assistantMessage: StudyAssistantMessage;
  studySession: StudySession;
};

function isFeedbackStyle(value: unknown): value is FeedbackStyle {
  return (
    typeof value === "string" &&
    (FEEDBACK_STYLES as readonly string[]).includes(value)
  );
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is StudyTextPart =>
        !!p &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("");
}

export async function ensureStudyChat({
  chatId,
  userId,
  title,
}: {
  chatId: string;
  userId: string;
  title?: string;
}) {
  const existing = await getChatById({ id: chatId });
  if (existing) {
    if (existing.userId !== userId) {
      throw new Error("forbidden");
    }
    return existing;
  }
  await saveChat({
    id: chatId,
    userId,
    title: title ?? "Agent session",
    visibility: "private",
  });
  return getChatById({ id: chatId });
}

export async function ensureStudySession({
  chatId,
  userId,
  feedbackStyle,
}: {
  chatId: string;
  userId: string;
  feedbackStyle?: FeedbackStyle;
}): Promise<StudySession> {
  const existing = await getStudySessionByChatId({ chatId });
  if (existing) return existing;
  if (!feedbackStyle || !isFeedbackStyle(feedbackStyle)) {
    throw new Error(
      "feedbackStyle is required to start a new study session",
    );
  }
  const { topicOrder, questionOrder } = pickStudyPlan();
  const created = await createStudySession({
    chatId,
    userId,
    feedbackStyle,
    topicOrder,
    questionOrder,
  });
  return created;
}

export async function runStudyTurn({
  chatId,
  userId,
  userMessage,
  feedbackStyle,
  chatTitle,
  persistUserMessage = true,
  ensureChat = true,
}: RunStudyTurnInput): Promise<RunStudyTurnResult> {
  if (ensureChat) {
    await ensureStudyChat({ chatId, userId, title: chatTitle });
  }
  const studySession = await ensureStudySession({
    chatId,
    userId,
    feedbackStyle,
  });

  if (persistUserMessage) {
    await saveMessages({
      messages: [
        {
          chatId,
          id: userMessage.id,
          role: "user",
          parts: userMessage.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });
  }

  const dbMessages = await getMessagesByChatId({ id: chatId });
  const uiMessages = convertToUIMessages(dbMessages);

  const responsesInput = uiMessages
    .map((m) => {
      const text = textFromParts(m.parts);
      if (!text) return null;
      if (m.role !== "user" && m.role !== "assistant") return null;
      return { role: m.role, content: text };
    })
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } => m !== null,
    );

  const questionsBlock = formatQuestionsBlock(
    studySession.topicOrder as number[],
    studySession.questionOrder as number[][],
  );

  const studyModel = process.env.STUDY_MODEL ?? "gpt-4o-mini";

  const response = await openaiClient.responses.create({
    model: studyModel,
    prompt: {
      id: STUDY_PROMPT_ID,
      version: STUDY_PROMPT_VERSION,
      variables: {
        questions: questionsBlock,
        feedback_style: studySession.feedbackStyle as FeedbackStyle,
      },
    },
    input: responsesInput,
  });

  const assistantText = response.output_text ?? "";
  const assistantMessage: StudyAssistantMessage = {
    id: generateUUID(),
    role: "assistant",
    parts: [{ type: "text", text: assistantText }],
  };

  await saveMessages({
    messages: [
      {
        chatId,
        id: assistantMessage.id,
        role: "assistant",
        parts: assistantMessage.parts,
        attachments: [],
        createdAt: new Date(),
      },
    ],
  });

  return { assistantMessage, studySession };
}
