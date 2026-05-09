import { z } from "zod";
import { requireAgentAuth } from "@/lib/agent-auth";
import {
  createAgentChatAndSession,
  getChatById,
  getInvitationByJti,
  redeemInvitation,
  upsertParticipant,
} from "@/lib/db/queries";
import { isCondition, promptForCondition } from "@/lib/study/conditions";
import { verifyInvitation } from "@/lib/study/invitations";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

const bodySchema = z.object({
  chatId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(20000).optional(),
  participantExternalId: z.string().min(1).max(200),
  participantMetadata: z.record(z.unknown()).optional(),
  invitationToken: z.string().min(1),
  partnerModel: z.string().min(1).max(200).optional(),
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

  let claims: Awaited<ReturnType<typeof verifyInvitation>>;
  try {
    claims = await verifyInvitation(parsed.invitationToken);
  } catch (_) {
    return Response.json({ error: "invalid_invitation" }, { status: 401 });
  }

  // Defense in depth: check expiry against DB row in case of clock skew or
  // a token that verified but the DB has marked expired earlier.
  const stored = await getInvitationByJti({ jti: claims.jti });
  if (!stored) {
    return Response.json({ error: "invalid_invitation" }, { status: 401 });
  }
  if (stored.expiresAt.getTime() <= Date.now()) {
    return Response.json({ error: "invitation_expired" }, { status: 401 });
  }

  // Idempotent retry: if the same caller (same externalId) already redeemed
  // this token, return the existing chatId instead of erroring on a network retry.
  if (
    stored.redeemedAt &&
    stored.redeemedByChatId &&
    stored.redeemedByExternalId === parsed.participantExternalId
  ) {
    return Response.json({
      chatId: stored.redeemedByChatId,
      condition: stored.condition,
      idempotent: true,
    });
  }

  if (parsed.chatId) {
    const existing = await getChatById({ id: parsed.chatId });
    if (existing && existing.partnerAgentId !== auth.partnerAgentId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (existing) {
      return Response.json({ error: "chat_exists" }, { status: 409 });
    }
  }

  const chatId = parsed.chatId ?? generateUUID();
  const title = parsed.title ?? "Agent session";

  const participant = await upsertParticipant({
    partnerAgentId: auth.partnerAgentId,
    externalId: parsed.participantExternalId,
    metadata: parsed.participantMetadata,
  });

  const redeem = await redeemInvitation({
    jti: claims.jti,
    chatId,
    externalId: parsed.participantExternalId,
  });
  if (!redeem.ok) {
    if (redeem.reason === "already_redeemed") {
      return Response.json({ error: "already_redeemed" }, { status: 409 });
    }
    return Response.json({ error: "invalid_invitation" }, { status: 401 });
  }

  if (!isCondition(redeem.condition)) {
    return Response.json({ error: "invalid_condition" }, { status: 500 });
  }
  const { promptId, version } = promptForCondition(redeem.condition);

  const { agentSession } = await createAgentChatAndSession({
    chatId,
    partnerAgentId: auth.partnerAgentId,
    participantId: participant.id,
    userId: participant.userId,
    title,
    instructions: parsed.instructions,
    promptId,
    promptVersion: version,
    condition: redeem.condition,
    partnerModel: parsed.partnerModel,
  });

  return Response.json({
    chatId,
    condition: redeem.condition,
    agentSession,
  });
}
