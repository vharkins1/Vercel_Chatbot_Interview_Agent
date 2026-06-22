-- Store only a one-way keyed hash of the request IP, never the raw IP (PII).
--
-- This is the ADDITIVE half: it adds the hash columns alongside the existing
-- raw IP columns (added in 0017) so a backfill (scripts/backfill-ip-hash.ts)
-- can populate them from the raw IPs before the raw columns are dropped in
-- 0021. The hash is a deterministic SHA-256 of the IP plus a stable secret
-- pepper (IP_HASH_PEPPER, falling back to APP_PEPPER), so identical IPs still
-- produce identical hashes for "same source?" dedup while the raw IP is never
-- persisted going forward.

ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "startIpHash" text;--> statement-breakpoint
ALTER TABLE "Message_v2" ADD COLUMN IF NOT EXISTS "ipHash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Chat_startIpHash_idx" ON "Chat" ("startIpHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_v2_ipHash_idx" ON "Message_v2" ("ipHash");
