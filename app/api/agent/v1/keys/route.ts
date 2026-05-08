import { createHash, randomBytes } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { z } from "zod";
import { createPartnerAgent } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";

export const maxDuration = 10;

const bodySchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "label must be alphanumeric or hyphen")
    .optional(),
});

function hashApiKey(raw: string): string {
  const pepper = process.env.APP_PEPPER ?? "";
  return createHash("sha256")
    .update(raw + pepper)
    .digest("hex");
}

export async function POST(request: Request) {
  if (!process.env.APP_PEPPER) {
    return Response.json({ error: "agent_api_disabled" }, { status: 503 });
  }

  try {
    await checkIpRateLimit(ipAddress(request));
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    throw error;
  }

  let label: string | undefined;
  try {
    const text = await request.text();
    const json = text ? JSON.parse(text) : {};
    label = bodySchema.parse(json).label;
  } catch (_) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const prefix = (label ?? "agent").toLowerCase();
  const suffix = randomBytes(8).toString("hex");
  const name = `${prefix}-${suffix}`;

  const rawKey = randomBytes(32).toString("base64url");
  const keyHash = hashApiKey(rawKey);

  try {
    const partner = await createPartnerAgent({ name, keyHash });
    return Response.json(
      { apiKey: rawKey, partnerName: partner.name },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    console.error("self-issue key failed:", error);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
