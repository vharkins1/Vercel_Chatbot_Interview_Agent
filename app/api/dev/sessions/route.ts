import { z } from "zod";
import { buildSessionCookie, signParticipantSession } from "@/lib/participant-auth";
import { getRequestIp, hashIp } from "@/lib/request-ip";
import { labelForCondition } from "@/lib/study/conditions";
import { parseUserAgent } from "@/lib/study/device";
import { createInterviewSession } from "@/lib/study/session-service";
import { generateUUID } from "@/lib/utils";

const CreateDevSessionSchema = z.object({
  devPromptId: z.string().min(1),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = CreateDevSessionSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const chatId = generateUUID();
  const participantExternalId = generateUUID();

  const ip = getRequestIp(request);
  const ipHash = ip ? await hashIp(ip) : null;
  const userAgent = request.headers.get("user-agent");
  const parsedUa = parseUserAgent(userAgent);

  await createInterviewSession({
    chatId,
    partnerAgentId: null,
    participantExternalId,
    condition: "DEV",
    title: "Developer Test Session",
    startIpHash: ipHash,
    qualtricsResponseId: "dev-mode",
    device: userAgent ? { ...parsedUa, userAgent } : null,
    overridePromptId: parsed.data.devPromptId,
  });

  const { token, maxAge } = await signParticipantSession({
    chatId,
    jti: generateUUID(), // fake JTI for the session
  });

  const payload = {
    chatId,
    condition: "DEV",
    conditionLabel: labelForCondition("DEV"),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": buildSessionCookie(token, maxAge),
    },
  });
}
