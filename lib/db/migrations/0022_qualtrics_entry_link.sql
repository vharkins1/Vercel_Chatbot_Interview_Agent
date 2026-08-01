-- Qualtrics-first participant flow.
--
-- The recruitment model changes from "one one-shot link per participant, with
-- the arm baked into the token at mint time" to "one reusable entry link for
-- everyone, with the arm drawn server-side at session creation". Identity is no
-- longer carried by the token; it comes from the Qualtrics ResponseID of the
-- PRE-interview survey, passed in as the `rid` query param.
--
-- Invitation.condition becomes nullable: NULL means "server assigns", which is
-- what keeps the arm out of Qualtrics entirely and preserves blinding. Existing
-- one-shot rows keep their pinned condition and multiUse = false, so the old
-- recruitment path is unaffected.

ALTER TABLE "Invitation" ALTER COLUMN "condition" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "multiUse" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "useCount" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Join key across pre-survey ↔ transcript ↔ post-survey.
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "qualtricsResponseId" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AgentSession_qualtricsResponseId_idx" ON "AgentSession" ("qualtricsResponseId");--> statement-breakpoint

-- Device/browser the interview was taken on, derived from the User-Agent at
-- session creation. Dedicated columns (not JSONB) so device can be a grouping
-- variable in SQL.
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "deviceType" text;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "browser" text;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "os" text;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "userAgent" text;
