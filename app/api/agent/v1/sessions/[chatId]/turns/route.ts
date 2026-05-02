import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { getChatById } from "@/lib/db/queries";
import { runStudyTurn } from "@/lib/study/turn";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 60;

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

  try {
    const { assistantMessage, studySession } = await runStudyTurn({
      chatId,
      userId: auth.userId,
      userMessage: {
        id: parsed.messageId ?? generateUUID(),
        role: "user",
        parts: [{ type: "text", text: parsed.text }],
      },
    });

    return Response.json({ assistantMessage, studySession });
  } catch (error) {
    console.error("agent turn failed:", error);
    return Response.json({ error: "turn_failed" }, { status: 500 });
  }
}
