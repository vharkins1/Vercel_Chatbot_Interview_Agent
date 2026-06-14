import { createHash } from "node:crypto";

export function getRequestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = request.headers.get("x-real-ip");
  if (real) {
    return real.trim();
  }
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return null;
}

/**
 * Deterministic, keyed one-way hash of an IP address.
 *
 * We never persist the raw IP (it is PII). We store only this hash so the SAME
 * IP always yields the SAME hash — that determinism is what enables
 * "is this the same source?" dedup — while the value stays non-reversible.
 *
 * A STABLE SECRET pepper (`IP_HASH_PEPPER`, falling back to `APP_PEPPER`) is
 * REQUIRED for non-reversibility: the IPv4 space is tiny and trivially
 * brute-forceable against an unsalted SHA-256. The pepper must not change
 * between writes, or previously stored hashes will no longer match new ones.
 *
 * Duplicates the small crypto call from `hashApiKey` on purpose — that lives in
 * a server-only module we don't want to import here.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) {
    return null;
  }
  const pepper = process.env.IP_HASH_PEPPER ?? process.env.APP_PEPPER ?? "";
  return createHash("sha256")
    .update(ip + pepper)
    .digest("hex");
}
