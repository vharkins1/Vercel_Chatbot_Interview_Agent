ALTER TABLE "Message_v2" ADD COLUMN IF NOT EXISTS "partnerModel" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Message_v2_partnerModel_idx" ON "Message_v2" ("partnerModel");
