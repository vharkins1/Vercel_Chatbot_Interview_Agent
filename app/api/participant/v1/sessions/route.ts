import { z } from "zod";
import { getInvitationByJti, redeemInvitation } from "@/lib/db/queries";
import {
  buildSessionCookie,
  signParticipantSession,
} from "@/lib/participant-auth";
import { getRequestIp } from "@/lib/request-ip";
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
    startIp: getRequestIp(request),
  });

  const { token, maxAge } = await signParticipantSession({
    chatId,
    jti: claims.jti,
  });

  return new Response(JSON.stringify({ chatId, condition }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": buildSessionCookie(token, maxAge),
    },
  });
}
