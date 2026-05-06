CREATE TABLE IF NOT EXISTS "Participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partnerAgentId" uuid NOT NULL,
	"externalId" text NOT NULL,
	"userId" uuid NOT NULL,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PartnerAgent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"keyHash" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	"lastUsedAt" timestamp,
	CONSTRAINT "PartnerAgent_name_unique" UNIQUE("name"),
	CONSTRAINT "PartnerAgent_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "partnerAgentId" uuid;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "participantId" uuid;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "partnerAgentId" uuid;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "participantId" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Participant" ADD CONSTRAINT "Participant_partnerAgentId_PartnerAgent_id_fk" FOREIGN KEY ("partnerAgentId") REFERENCES "public"."PartnerAgent"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Participant_partner_external_uq" ON "Participant" USING btree ("partnerAgentId","externalId");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_partnerAgentId_PartnerAgent_id_fk" FOREIGN KEY ("partnerAgentId") REFERENCES "public"."PartnerAgent"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_participantId_Participant_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."Participant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_partnerAgentId_PartnerAgent_id_fk" FOREIGN KEY ("partnerAgentId") REFERENCES "public"."PartnerAgent"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_participantId_Participant_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."Participant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_partner_pair_chk" CHECK ((("partnerAgentId" IS NULL) = ("participantId" IS NULL)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_partner_pair_chk" CHECK ((("partnerAgentId" IS NULL) = ("participantId" IS NULL)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Legacy wipe: remove rows created under the previous single shared service-user id
DELETE FROM "AgentSession" WHERE "userId" = '38ad68a9-2fe7-4388-ae23-29073526fc90';
--> statement-breakpoint
DELETE FROM "Vote_v2" WHERE "chatId" IN (SELECT "id" FROM "Chat" WHERE "userId" = '38ad68a9-2fe7-4388-ae23-29073526fc90');
--> statement-breakpoint
DELETE FROM "Stream" WHERE "chatId" IN (SELECT "id" FROM "Chat" WHERE "userId" = '38ad68a9-2fe7-4388-ae23-29073526fc90');
--> statement-breakpoint
DELETE FROM "Message_v2" WHERE "chatId" IN (SELECT "id" FROM "Chat" WHERE "userId" = '38ad68a9-2fe7-4388-ae23-29073526fc90');
--> statement-breakpoint
DELETE FROM "Chat" WHERE "userId" = '38ad68a9-2fe7-4388-ae23-29073526fc90';
