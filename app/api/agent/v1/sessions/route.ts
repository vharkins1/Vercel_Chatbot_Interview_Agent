import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { createStudySession, saveChat } from "@/lib/db/queries";
import { generateUUID } from "@/lib/utils";
import { FEEDBACK_STYLES } from "@/lib/study/protocol";
import { formatQuestionsBlock, pickStudyPlan } from "@/lib/study/selection";

export const maxDuration = 30;

const bodySchema = z.object({
  feedbackStyle: z.enum(FEEDBACK_STYLES),
  chatId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const auth = requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const chatId = parsed.chatId ?? generateUUID();
  const title = parsed.title ?? "Agent session";

  await saveChat({
    id: chatId,
    userId: auth.userId,
    title,
    visibility: "private",
  });

  const { topicOrder, questionOrder } = pickStudyPlan();
  const studySession = await createStudySession({
    chatId,
    userId: auth.userId,
    feedbackStyle: parsed.feedbackStyle,
    topicOrder,
    questionOrder,
  });

  return Response.json({
    chatId,
    studySession,
    questionsBlock: formatQuestionsBlock(topicOrder, questionOrder),
  });
}
