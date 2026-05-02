import "server-only";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export type AgentAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export function requireAgentAuth(request: Request): AgentAuthResult {
  const apiKey = process.env.AGENT_API_KEY;
  const userId = process.env.AGENT_USER_ID;

  if (!apiKey || !userId) {
    return {
      ok: false,
      response: Response.json(
        { error: "agent_api_disabled" },
        { status: 503 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${apiKey}`;

  if (!timingSafeEqual(header, expected)) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, userId };
}
