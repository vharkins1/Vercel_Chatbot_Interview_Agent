import "server-only";

import { jwtVerify, SignJWT } from "jose";

const ALG = "HS256";
export const PARTICIPANT_COOKIE = "participant_session";
const COOKIE_TTL_SECONDS = 60 * 60 * 2; // 2 hours

function getSecret(): Uint8Array {
  const secret = process.env.INVITE_JWT_SECRET;
  if (!secret) {
    throw new Error("INVITE_JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export type ParticipantSessionClaims = {
  chatId: string;
  jti: string;
  exp: number;
};

export async function signParticipantSession(params: {
  chatId: string;
  jti: string;
}): Promise<{ token: string; maxAge: number }> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    chatId: params.chatId,
    jti: params.jti,
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + COOKIE_TTL_SECONDS)
    .sign(getSecret());
  return { token, maxAge: COOKIE_TTL_SECONDS };
}

export async function verifyParticipantSession(
  token: string
): Promise<ParticipantSessionClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: [ALG],
  });
  const chatId = payload.chatId;
  const jti = payload.jti;
  const exp = payload.exp;
  if (typeof chatId !== "string" || typeof jti !== "string") {
    throw new Error("invalid participant session");
  }
  if (typeof exp !== "number") {
    throw new Error("invalid participant session");
  }
  return { chatId, jti, exp };
}

export function buildSessionCookie(token: string, maxAge: number): string {
  const attrs = [
    `${PARTICIPANT_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}
