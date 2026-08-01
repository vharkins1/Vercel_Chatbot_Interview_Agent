import { z } from "zod";
import { type AgentAuthResult, requireAgentAuth } from "@/lib/agent-auth";
import {
  createAgentChatAndSession,
  getActiveAgentSessionForParticipant,
  getChatById,
  getInvitationByJti,
  redeemInvitation,
  upsertParticipant,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { checkPartnerSessionRateLimit } from "@/lib/ratelimit";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import { toAgentSessionDTO } from "@/lib/study/agent-session-dto";
import {
  type Condition,
  isCondition,
  labelForCondition,
  pickRandomCondition,
  promptForCondition,
} from "@/lib/study/conditions";
import { verifyInvitation } from "@/lib/study/invitations";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

const bodySchema = z.object({
  chatId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(20_000).optional(),
  participantExternalId: z.string().min(1).max(200),
  participantMetadata: z.record(z.unknown()).optional(),
  invitationToken: z.string().min(1).optional(),
  partnerModel: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const auth = await requireAgentAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  // Error boundary: without this, any throw below (missing OPENAI_*_PROMPT_ID,
  // unseeded question bank, DB failure) escapes the route handler and Next.js
  // returns a bare HTTP 500 with an empty body — a silent crash that's invisible
  // in logs. Map ChatbotError to its intended status/body; log + 500 the rest so
  // the real cause shows up in the function logs.
  try {
    return await createSession(request, auth);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    console.error("[POST /api/agent/v1/sessions] unhandled error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

type AuthOk = Extract<AgentAuthResult, { ok: true }>;

async function createSession(request: Request, auth: AuthOk) {
  try {
    await checkPartnerSessionRateLimit(auth.partnerAgentId);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json().catch(() => ({}));
    parsed = bodySchema.parse(json);
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  // Token branch: verify shape + DB row up front so a bad token fails fast,
  // before we do any DB writes. Resolution (redeem) happens later, only if
  // we actually go on to create a new session.
  let tokenJti: string | null = null;
  let tokenCondition: Condition | null = null;
  if (parsed.invitationToken) {
    let claims: Awaited<ReturnType<typeof verifyInvitation>>;
    try {
      claims = await verifyInvitation(parsed.invitationToken);
    } catch (_) {
      return Response.json({ error: "invalid_invitation" }, { status: 401 });
    }

    const stored = await getInvitationByJti({ jti: claims.jti });
    if (!stored) {
      return Response.json({ error: "invalid_invitation" }, { status: 401 });
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      return Response.json({ error: "invitation_expired" }, { status: 401 });
    }

    // Token-based idempotent retry: same token, same caller → return the
    // chat that token was already redeemed for.
    if (
      stored.redeemedAt &&
      stored.redeemedByChatId &&
      stored.redeemedByExternalId === parsed.participantExternalId
    ) {
      return Response.json({
        chatId: stored.redeemedByChatId,
        idempotent: true,
        reason: "token_already_redeemed_by_caller",
      });
    }

    if (!isCondition(stored.condition)) {
      return Response.json({ error: "invalid_condition" }, { status: 500 });
    }
    tokenJti = claims.jti;
    tokenCondition = stored.condition;
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

  const active = await getActiveAgentSessionForParticipant({
    participantId: participant.id,
  });
  if (active) {
    return Response.json({
      chatId: active.chatId,
      agentSession: toAgentSessionDTO(active),
      idempotent: true,
      reason: "participant_has_active_session",
    });
  }

  let condition: Condition;
  if (tokenJti && tokenCondition) {
    const redeem = await redeemInvitation({
      jti: tokenJti,
      chatId,
      externalId: parsed.participantExternalId,
    });
    if (!redeem.ok) {
      if (redeem.reason === "already_redeemed") {
        return Response.json({ error: "already_redeemed" }, { status: 409 });
      }
      return Response.json({ error: "invalid_invitation" }, { status: 401 });
    }
    // A token that pins no arm (the Qualtrics entry link) is not an error here
    // — it just means the arm was never fixed, so draw one as if no token had
    // been supplied at all.
    condition = isCondition(redeem.condition)
      ? redeem.condition
      : pickRandomCondition();
  } else {
    condition = pickRandomCondition();
  }

  const { promptId, version } = promptForCondition(condition);

  const ip = getRequestIp(request);

  const { agentSession } = await createAgentChatAndSession({
    chatId,
    partnerAgentId: auth.partnerAgentId,
    participantId: participant.id,
    userId: participant.userId,
    title,
    instructions: parsed.instructions,
    promptId,
    promptVersion: version,
    condition,
    conditionLabel: labelForCondition(condition),
    partnerModel: parsed.partnerModel,
    startIpHash: hashIp(ip),
  });

  return Response.json({
    chatId,
    agentSession: toAgentSessionDTO(agentSession),
  });
}
