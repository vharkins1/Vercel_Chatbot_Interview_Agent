-- Qualtrics handoff: completionCode anchor on AgentSession + SurveySubmission
-- (header / cursor) + SurveyAnswer (one row per QID). Bidirectional join between
-- our DB and Qualtrics. See docs/goal.md "Deferred work".

ALTER TABLE "AgentSession" ADD COLUMN "completionCode" text;--> statement-breakpoint
CREATE UNIQUE INDEX "AgentSession_completionCode_idx" ON "AgentSession" ("completionCode");--> statement-breakpoint

CREATE TABLE "SurveySubmission" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "chatId" uuid NOT NULL UNIQUE REFERENCES "Chat"("id"),
  "surveyId" text NOT NULL,
  "currentPage" integer NOT NULL DEFAULT 0,
  "totalPages" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'in_progress',
  "qualtricsResponseId" text,
  "lastError" text,
  "submittedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "SurveySubmission_qualtricsResponseId_idx" ON "SurveySubmission" ("qualtricsResponseId");--> statement-breakpoint
CREATE INDEX "SurveySubmission_status_idx" ON "SurveySubmission" ("status");--> statement-breakpoint

CREATE TABLE "SurveyAnswer" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "chatId" uuid NOT NULL REFERENCES "Chat"("id"),
  "qid" text NOT NULL,
  "value" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "SurveyAnswer_chatId_qid_idx" ON "SurveyAnswer" ("chatId", "qid");--> statement-breakpoint
CREATE INDEX "SurveyAnswer_qid_idx" ON "SurveyAnswer" ("qid");
