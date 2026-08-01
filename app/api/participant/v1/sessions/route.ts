import { z } from "zod";
import {
  getHumanSessionByQualtricsResponseId,
  getInvitationByJti,
  getMessagesByChatId,
  hasChatWithStartIpHash,
  recordInvitationUse,
  redeemInvitation,
} from "@/lib/db/queries";
import {
  buildSessionCookie,
  signParticipantSession,
} from "@/lib/participant-auth";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import {
  type Condition,
  isCondition,
  labelForCondition,
  pickRandomCondition,
} from "@/lib/study/conditions";
import { parseUserAgent } from "@/lib/study/device";
import { verifyInvitation } from "@/lib/study/invitations";
import { createInterviewSession } from "@/lib/study/session-service";
import { generateUUID } from "@/lib/utils";

export const maxDuration = 30;

/**
 * Messages are stored as `[{ type: "text", text }]` parts. Flatten to a plain
 * string for the resume payload so the chat UI does not need parts handling.
 */
function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text ?? "")
        : ""
    )
    .join("");
}

const bodySchema = z.object({
  invitationToken: z.string().min(1),
  participantExternalId: z.string().min(1).max(200).optional(),
  // Qualtrics ResponseID of the PRE-interview survey, forwarded by the chat UI
  // from the `rid` query param on the entry link. Optional so the older
  // one-shot recruitment links keep working unchanged.
  qualtricsResponseId: z.string().min(1).max(200).optional(),
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
  // A null condition is the entry link: the arm is drawn below rather than
  // pinned here. A non-null but unrecognised condition is corrupt data.
  if (stored.condition !== null && !isCondition(stored.condition)) {
    return Response.json({ error: "invalid_condition" }, { status: 500 });
  }

  // Idempotency for the reusable entry link. The same URL serves every
  // participant, so a reload or back-button would otherwise start a second
  // interview for the same respondent and split their turns across two
  // transcripts. Keyed on the Qualtrics ResponseID, which is unique per
  // pre-survey respondent. Mirrors the agent API's idempotency on
  // (partner, participantExternalId).
  if (parsed.qualtricsResponseId) {
    const existing = await getHumanSessionByQualtricsResponseId({
      qualtricsResponseId: parsed.qualtricsResponseId,
    });
    if (existing) {
      // Completed interviews are terminal: sending them back into the chat
      // would let a participant append turns after their survey handoff.
      if (existing.completedAt) {
        return Response.json({ error: "already_completed" }, { status: 409 });
      }
      const [resumed, priorMessages] = await Promise.all([
        signParticipantSession({ chatId: existing.chatId, jti: claims.jti }),
        getMessagesByChatId({ id: existing.chatId }),
      ]);
      // Hand back the transcript so the UI can rehydrate. Without it the page
      // would look like a fresh interview and re-fire the hidden seed turn,
      // making the interviewer greet the participant a second time mid-way
      // through.
      return new Response(
        JSON.stringify({
          chatId: existing.chatId,
          resumed: true,
          messages: priorMessages.map((m) => ({
            id: m.id,
            role: m.role,
            text: textFromParts(m.parts),
          })),
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": buildSessionCookie(resumed.token, resumed.maxAge),
          },
        }
      );
    }
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

  // Reusability is a property of the invitation row (the Qualtrics entry link
  // is minted multiUse), not of the deployment. The older
  // PARTICIPANT_INVITATIONS_REUSABLE env flag stays honoured for the pre-launch
  // testing links it was added for, but it is no longer how the live human flow
  // works — see docs/goal.md.
  const reusable =
    stored.multiUse || process.env.PARTICIPANT_INVITATIONS_REUSABLE === "1";

  if (!reusable && stored.redeemedAt && stored.redeemedByChatId) {
    return Response.json({ error: "already_redeemed" }, { status: 409 });
  }

  const chatId = generateUUID();
  // With the entry link the Qualtrics ResponseID *is* the participant's
  // identity — the token no longer distinguishes anyone. Falling back to a
  // random id keeps the pre-Qualtrics recruitment links working.
  const participantExternalId =
    parsed.qualtricsResponseId ??
    parsed.participantExternalId ??
    generateUUID();

  let condition: Condition | null = isCondition(stored.condition)
    ? stored.condition
    : null;
  if (reusable) {
    if (stored.multiUse) {
      await recordInvitationUse({
        jti: claims.jti,
        chatId,
        externalId: participantExternalId,
      });
    }
  } else {
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
    condition = isCondition(redeem.condition) ? redeem.condition : null;
  }

  // Arm assignment. A pinned condition (one-shot recruitment token) wins; the
  // entry link pins nothing, so we draw simple-random here — at the moment of
  // exposure, not at redirect time, so participants who click through and
  // abandon before starting never consume an arm. Qualtrics is never told
  // which arm was drawn; it is recovered at analysis time by joining
  // AgentSession on the Qualtrics ResponseID.
  if (!isCondition(condition)) {
    condition = pickRandomCondition();
  }

  const userAgent = request.headers.get("user-agent");
  const parsedUa = parseUserAgent(userAgent);

  await createInterviewSession({
    chatId,
    partnerAgentId: null,
    participantExternalId,
    condition,
    title: "Participant interview",
    startIpHash: ipHash,
    qualtricsResponseId: parsed.qualtricsResponseId ?? null,
    device: userAgent ? { ...parsedUa, userAgent } : null,
  });

  const { token, maxAge } = await signParticipantSession({
    chatId,
    jti: claims.jti,
  });

  // Condition is intentionally NOT returned to the browser in production — it's
  // the blinded study arm and must stay staff-only. It's persisted on
  // AgentSession above and recovered server-side at analysis time via the
  // chat_id/completion_code join.
  //
  // TEMPORARY UNBLINDING (testing only): when UNBLIND_FRONTEND === "1" we also
  // return the A/B/C code and its descriptive label so the participant UI can
  // surface a staff/debug badge. UNBLIND_FRONTEND MUST be UNSET in prod before
  // real participants — see docs/goal.md pre-launch checklist. When the flag is
  // unset the response is byte-identical to `{ chatId }`.
  const payload: {
    chatId: string;
    condition?: Condition;
    conditionLabel?: string;
  } = { chatId };
  if (process.env.UNBLIND_FRONTEND === "1") {
    payload.condition = condition;
    payload.conditionLabel = labelForCondition(condition);
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": buildSessionCookie(token, maxAge),
    },
  });
}
