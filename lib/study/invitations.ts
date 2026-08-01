import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { type Condition, isCondition } from "./conditions";

const ALG = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.INVITE_JWT_SECRET;
  if (!secret) {
    throw new Error("INVITE_JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export function generateJti(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * `condition: null` mints an entry-link token that pins no arm — the server
 * draws one at session creation. Omitting the claim entirely (rather than
 * encoding a null) keeps the token opaque: nothing in the JWT payload hints
 * that arms exist at all, which matters because the entry link is a single
 * public URL that participants can decode.
 */
export async function signInvitation(params: {
  jti: string;
  condition: Condition | null;
  ttlSeconds: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = params.condition ? { condition: params.condition } : {};
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setJti(params.jti)
    .setIssuedAt(now)
    .setExpirationTime(now + params.ttlSeconds)
    .sign(getSecret());
}

export type VerifiedInvitation = {
  jti: string;
  condition: Condition | null;
  exp: number;
};

export async function verifyInvitation(
  token: string
): Promise<VerifiedInvitation> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: [ALG],
  });
  if (!payload.jti || typeof payload.jti !== "string") {
    throw new Error("invitation missing jti");
  }
  if (typeof payload.exp !== "number") {
    throw new Error("invitation missing exp");
  }
  // Absent is legitimate (entry link); present-but-malformed is not, since it
  // would silently reassign an arm the operator believed was pinned.
  if (payload.condition !== undefined && !isCondition(payload.condition)) {
    throw new Error("invitation has invalid condition");
  }
  return {
    jti: payload.jti,
    condition: isCondition(payload.condition) ? payload.condition : null,
    exp: payload.exp,
  };
}
