ALTER TABLE "AgentSession" ADD COLUMN "promptId" text;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN "promptVersion" text;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN "totalTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AgentSession_partnerAgentId_idx" ON "AgentSession" USING btree ("partnerAgentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AgentSession_participantId_idx" ON "AgentSession" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Chat_partnerAgentId_idx" ON "Chat" USING btree ("partnerAgentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Chat_participantId_idx" ON "Chat" USING btree ("participantId");