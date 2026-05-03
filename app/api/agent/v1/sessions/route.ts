import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import {
  createAgentChatAndSession,
  getChatById,
  upsertParticipant,
} from "@/lib/db/queries";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

const POSITIVE_PROMPT_ID =
  process.env.OPENAI_POSITIVE_PROMPT_ID ??
  "pmpt_69f4f87ea46081948f36ba086c12c54b030113096792d76e";
const POSITIVE_PROMPT_VERSION =
  process.env.OPENAI_POSITIVE_PROMPT_VERSION ?? "2";

const bodySchema = z.object({
  chatId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(20000).optional(),
  participantExternalId: z.string().min(1).max(200),
  participantMetadata: z.record(z.unknown()).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) return auth.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = bodySchema.parse(json);
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const chatId = parsed.chatId ?? generateUUID();
  const title = parsed.title ?? "Agent session";

  if (parsed.chatId) {
    const existing = await getChatById({ id: parsed.chatId });
    if (existing && existing.partnerAgentId !== auth.partnerAgentId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (existing) {
      return Response.json({ error: "chat_exists" }, { status: 409 });
    }
  }

  const participant = await upsertParticipant({
    partnerAgentId: auth.partnerAgentId,
    externalId: parsed.participantExternalId,
    metadata: parsed.participantMetadata,
  });

  const { agentSession } = await createAgentChatAndSession({
    chatId,
    partnerAgentId: auth.partnerAgentId,
    participantId: participant.id,
    userId: participant.userId,
    title,
    instructions: parsed.instructions,
    promptId: POSITIVE_PROMPT_ID,
    promptVersion: POSITIVE_PROMPT_VERSION,
  });

  return Response.json({ chatId, agentSession });
}
