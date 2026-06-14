import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { getChatById } from "@/lib/db/queries";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import { executeTurn } from "@/lib/study/session-service";

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  messageId: z.string().uuid().optional(),
  partnerModel: z.string().min(1).max(200).optional(),
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

  const ip = getRequestIp(request);

  const result = await executeTurn({
    chatId,
    text: parsed.text,
    userMessageId: parsed.messageId,
    partnerModel: parsed.partnerModel,
    ipHash: hashIp(ip),
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({
    assistantMessage: {
      id: result.assistantMessageId,
      role: "assistant",
      parts: [{ type: "text", text: result.assistantText }],
    },
    responseId: result.responseId,
  });
}
