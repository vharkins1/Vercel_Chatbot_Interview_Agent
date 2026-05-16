import "server-only";

import { createHash } from "node:crypto";
import {
  getPartnerAgentByKeyHash,
  touchPartnerAgentLastUsed,
} from "@/lib/db/queries";

export type AgentAuthResult =
  | { ok: true; partnerAgentId: string; partnerName: string }
  | { ok: false; response: Response };

export function hashApiKey(raw: string): string {
  const pepper = process.env.APP_PEPPER ?? "";
  return createHash("sha256")
    .update(raw + pepper)
    .digest("hex");
}

export async function requireAgentAuth(
  request: Request
): Promise<AgentAuthResult> {
  if (!process.env.APP_PEPPER) {
    return {
      ok: false,
      response: Response.json({ error: "agent_api_disabled" }, { status: 503 }),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const keyHash = hashApiKey(token);
  const partner = await getPartnerAgentByKeyHash(keyHash);

  if (!partner || partner.revokedAt) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // best-effort audit signal; don't await or fail the request on update errors
  void touchPartnerAgentLastUsed(partner.id);

  return { ok: true, partnerAgentId: partner.id, partnerName: partner.name };
}
