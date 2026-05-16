ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "startIp" text;
--> statement-breakpoint
ALTER TABLE "Message_v2" ADD COLUMN IF NOT EXISTS "ipAddress" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Chat_startIp_idx" ON "Chat" ("startIp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_v2_ipAddress_idx" ON "Message_v2" ("ipAddress");
