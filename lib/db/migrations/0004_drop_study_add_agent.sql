DROP TABLE "StudySession";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "AgentSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"responseId" text,
	"instructions" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "AgentSession_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
