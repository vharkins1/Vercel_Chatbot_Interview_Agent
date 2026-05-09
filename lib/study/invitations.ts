import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
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

export async function signInvitation(params: {
  jti: string;
  condition: Condition;
  ttlSeconds: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ condition: params.condition })
    .setProtectedHeader({ alg: ALG })
    .setJti(params.jti)
    .setIssuedAt(now)
    .setExpirationTime(now + params.ttlSeconds)
    .sign(getSecret());
}

export type VerifiedInvitation = {
  jti: string;
  condition: Condition;
  exp: number;
};

export async function verifyInvitation(
  token: string,
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
  if (!isCondition(payload.condition)) {
    throw new Error("invitation has invalid condition");
  }
  return {
    jti: payload.jti,
    condition: payload.condition,
    exp: payload.exp,
  };
}
