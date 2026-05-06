DROP TABLE IF EXISTS "StudySession";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "StudySession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"feedbackStyle" varchar NOT NULL,
	"topicOrder" json NOT NULL,
	"questionOrder" json NOT NULL,
	"surveyData" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "StudySession_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
