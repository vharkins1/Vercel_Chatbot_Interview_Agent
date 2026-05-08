CREATE TABLE IF NOT EXISTS "Topic" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"displayOrder" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topicId" text NOT NULL,
	"text" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ChatQuestion" (
	"chatId" uuid NOT NULL,
	"questionId" uuid NOT NULL,
	"topicId" text NOT NULL,
	"topicOrder" integer NOT NULL,
	"questionOrder" integer NOT NULL,
	"questionTextSnapshot" text NOT NULL,
	CONSTRAINT "ChatQuestion_pk" PRIMARY KEY ("chatId","questionId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_Topic_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."Topic"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ChatQuestion" ADD CONSTRAINT "ChatQuestion_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ChatQuestion" ADD CONSTRAINT "ChatQuestion_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ChatQuestion" ADD CONSTRAINT "ChatQuestion_topicId_Topic_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."Topic"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Question_topicId_idx" ON "Question" USING btree ("topicId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Question_topicId_text_uq" ON "Question" USING btree ("topicId","text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatQuestion_chatId_idx" ON "ChatQuestion" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ChatQuestion_topicId_idx" ON "ChatQuestion" USING btree ("topicId");
