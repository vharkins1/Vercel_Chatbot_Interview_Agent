import { auth } from "@/app/(auth)/auth";
import {
  createStudySession,
  getStudySessionByChatId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { formatQuestionsBlock, pickStudyPlan } from "@/lib/study/selection";
import { FEEDBACK_STYLES, type FeedbackStyle } from "@/lib/study/protocol";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const studySession = await getStudySessionByChatId({ chatId });
  return Response.json({ studySession });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { chatId, feedbackStyle } = await request.json();

  if (
    !chatId ||
    !feedbackStyle ||
    !FEEDBACK_STYLES.includes(feedbackStyle as FeedbackStyle)
  ) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const existing = await getStudySessionByChatId({ chatId });
  if (existing) {
    return Response.json({
      studySession: existing,
      questionsBlock: formatQuestionsBlock(
        existing.topicOrder as number[],
        existing.questionOrder as number[][],
      ),
    });
  }

  const { topicOrder, questionOrder } = pickStudyPlan();
  const studySession = await createStudySession({
    chatId,
    userId: session.user.id,
    feedbackStyle,
    topicOrder,
    questionOrder,
  });

  return Response.json({
    studySession,
    questionsBlock: formatQuestionsBlock(topicOrder, questionOrder),
  });
}
