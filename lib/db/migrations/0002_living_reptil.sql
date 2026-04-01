ALTER TABLE "StudySession" ADD COLUMN "topicOrder" json;--> statement-breakpoint
ALTER TABLE "StudySession" ADD COLUMN "topicSummaries" json;--> statement-breakpoint
ALTER TABLE "StudySession" ADD COLUMN "retryCount" integer DEFAULT 0 NOT NULL;