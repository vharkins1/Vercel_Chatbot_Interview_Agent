-- Drop the raw IP columns (PII) added in 0017. This is the DESTRUCTIVE half of
-- the IP-hash migration: it permanently deletes the stored raw IPs.
--
-- Run scripts/backfill-ip-hash.ts FIRST so Chat.startIpHash / Message_v2.ipHash
-- (added in 0020) carry the hashed form of these IPs before they are deleted.
-- After this migration, only the one-way hashes remain.

DROP INDEX IF EXISTS "Chat_startIp_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "Message_v2_ipAddress_idx";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN IF EXISTS "startIp";--> statement-breakpoint
ALTER TABLE "Message_v2" DROP COLUMN IF EXISTS "ipAddress";
