import { auth } from "@/app/(auth)/auth";
import {
  createStudySession,
  getStudySessionByChatId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { getQuestion, getTopicIntro, resolveTopicOrder } from "@/lib/study/protocol";

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

  const { chatId, condition } = await request.json();

  if (!chatId || !condition) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  // Check if session already exists
  const existing = await getStudySessionByChatId({ chatId });
  if (existing) {
    return Response.json({ studySession: existing });
  }

  const studySession = await createStudySession({
    chatId,
    userId: session.user.id,
    condition,
  });

  // Return session + first question info
  const topicOrder = resolveTopicOrder();
  const firstQuestion = await getQuestion(0, 0, topicOrder);
  return Response.json({
    studySession,
    firstQuestion,
    firstTopicIntro: getTopicIntro(0, topicOrder),
  });
}
