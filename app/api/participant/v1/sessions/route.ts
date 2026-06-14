import { z } from "zod";
import {
  getInvitationByJti,
  hasChatWithStartIpHash,
  redeemInvitation,
} from "@/lib/db/queries";
import {
  buildSessionCookie,
  signParticipantSession,
} from "@/lib/participant-auth";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import { isCondition } from "@/lib/study/conditions";
import { verifyInvitation } from "@/lib/study/invitations";
import { createInterviewSession } from "@/lib/study/session-service";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

const bodySchema = z.object({
  invitationToken: z.string().min(1),
  participantExternalId: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  if (!process.env.INVITE_JWT_SECRET) {
    return Response.json(
      { error: "participant_api_disabled" },
      { status: 503 }
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json().catch(() => ({})));
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

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
  if (!isCondition(stored.condition)) {
    return Response.json({ error: "invalid_condition" }, { status: 500 });
  }

  // One-IP-per-participant check. We hash the request IP (never store the raw
  // IP — see lib/request-ip.ts) and ask whether we've already started a HUMAN
  // interview from that same hashed source. End goal: if seen, block; if not,
  // let them in. For now we only COMPUTE + LOG the comparison and leave the
  // user in — the actual block is intentionally commented out below so we can
  // observe how often it would fire before enforcing it.
  //
  // This whole check is on a NON-FATAL path: it must never stop a legitimate
  // interview from starting. If the lookup errors we fail open (treat as
  // not-seen) and log — and even once the block is enabled, failing open is
  // the safe default for a study (better to let a dup through than to wrongly
  // reject a real participant on an infra hiccup).
  const ipHash = hashIp(getRequestIp(request));
  let seenBefore = false;
  try {
    seenBefore = await hasChatWithStartIpHash({ startIpHash: ipHash });
  } catch (error) {
    console.error("[ip-dedup] seen-before check failed (failing open):", error);
  }
  if (seenBefore) {
    console.warn(
      `[ip-dedup] repeat IP hash at participant session start (would block) ipHash=${ipHash}`
    );
    // TODO(enable to enforce): block a repeat participant from the same IP.
    // return Response.json({ error: "already_participated" }, { status: 403 });
  }

  // Pre-launch testing mode: lets the research team share one link.
  // MUST be unset in prod before real participants — see docs/goal.md
  // pre-launch checklist.
  const reusableMode = process.env.PARTICIPANT_INVITATIONS_REUSABLE === "1";

  if (!reusableMode && stored.redeemedAt && stored.redeemedByChatId) {
    return Response.json({ error: "already_redeemed" }, { status: 409 });
  }

  const chatId = generateUUID();
  const participantExternalId = parsed.participantExternalId ?? generateUUID();

  let condition = stored.condition;
  if (!reusableMode) {
    const redeem = await redeemInvitation({
      jti: claims.jti,
      chatId,
      externalId: participantExternalId,
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
    condition = redeem.condition;
  }

  await createInterviewSession({
    chatId,
    partnerAgentId: null,
    participantExternalId,
    condition,
    title: "Participant interview",
    startIpHash: ipHash,
  });

  const { token, maxAge } = await signParticipantSession({
    chatId,
    jti: claims.jti,
  });

  // Condition is intentionally NOT returned to the browser — it's the blinded
  // study arm and must stay staff-only. It's persisted on AgentSession above and
  // recovered server-side at analysis time via the chat_id/completion_code join.
  return new Response(JSON.stringify({ chatId }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": buildSessionCookie(token, maxAge),
    },
  });
}
