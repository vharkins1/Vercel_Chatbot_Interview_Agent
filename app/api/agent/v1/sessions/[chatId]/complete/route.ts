import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import {
  getChatById,
  getMessagesByChatId,
  getStudySessionByChatId,
  updateStudySession,
} from "@/lib/db/queries";

const bodySchema = z
  .object({
    surveyData: z.unknown().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  const { chatId } = await params;

  const chat = await getChatById({ id: chatId });
  if (!chat) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (chat.userId !== auth.userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema> = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      const json = await request.json().catch(() => ({}));
      body = bodySchema.parse(json);
    } catch (_) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
  }

  const studySession = await getStudySessionByChatId({ chatId });
  if (!studySession) {
    return Response.json({ error: "no_study_session" }, { status: 404 });
  }

  await updateStudySession({
    id: studySession.id,
    completedAt: new Date(),
    ...(body.surveyData !== undefined && { surveyData: body.surveyData }),
  });

  const [refreshed, messages] = await Promise.all([
    getStudySessionByChatId({ chatId }),
    getMessagesByChatId({ id: chatId }),
  ]);

  return Response.json({
    chatId,
    studySession: refreshed,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    })),
  });
}
