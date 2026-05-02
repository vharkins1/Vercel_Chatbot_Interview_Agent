import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import { createAgentSession, saveChat } from "@/lib/db/queries";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

const bodySchema = z.object({
  chatId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(20000).optional(),
});

export async function POST(request: Request) {
  const auth = requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  let parsed: z.infer<typeof bodySchema> = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      const json = await request.json().catch(() => ({}));
      parsed = bodySchema.parse(json);
    } catch (_) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
  }

  const chatId = parsed.chatId ?? generateUUID();
  const title = parsed.title ?? "Agent session";

  await saveChat({
    id: chatId,
    userId: auth.userId,
    title,
    visibility: "private",
  });

  const agentSession = await createAgentSession({
    chatId,
    userId: auth.userId,
    instructions: parsed.instructions,
  });

  return Response.json({ chatId, agentSession });
}
