-- Align the physical study schema with the names used by researchers while
-- preserving every existing session, transcript, question-bank row, and
-- per-chat question selection.

-- The pre-survey Qualtrics response identifier is the study-wide StudyID.
ALTER TABLE "AgentSession" RENAME COLUMN "qualtricsResponseId" TO "StudyID";--> statement-breakpoint
ALTER INDEX "AgentSession_qualtricsResponseId_idx" RENAME TO "AgentSession_StudyID_idx";--> statement-breakpoint

-- The transcript table is exposed under its analysis-facing name. The two
-- chatId foreign keys are historical duplicates; retain one canonical FK.
ALTER TABLE "Message_v2" DROP CONSTRAINT IF EXISTS "Message_v2_chatId_fkey";--> statement-breakpoint
ALTER TABLE "Message_v2" RENAME TO "ChatLogs";--> statement-breakpoint
ALTER TABLE "ChatLogs" RENAME CONSTRAINT "Message_v2_pkey" TO "ChatLogs_pkey";--> statement-breakpoint
ALTER TABLE "ChatLogs" RENAME CONSTRAINT "Message_v2_chatId_Chat_id_fk" TO "ChatLogs_chatId_Chat_id_fk";--> statement-breakpoint
ALTER INDEX "Message_v2_ipHash_idx" RENAME TO "ChatLogs_ipHash_idx";--> statement-breakpoint
ALTER INDEX "Message_v2_partnerModel_idx" RENAME TO "ChatLogs_partnerModel_idx";--> statement-breakpoint

-- Keep the old normalized question objects until their contents have been
-- copied and checked. Their foreign keys continue to point to one another under
-- these temporary names.
ALTER TABLE "ChatQuestion" RENAME TO "QuestionSelection_0025";--> statement-breakpoint
ALTER TABLE "Question" RENAME TO "QuestionBank_0025";--> statement-breakpoint
ALTER TABLE "Topic" RENAME TO "Topic_0025";--> statement-breakpoint

CREATE TABLE "Question" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chatId" uuid REFERENCES "Chat"("id") ON DELETE CASCADE,
  "sourceQuestionId" uuid REFERENCES "Question"("id"),
  "topicId" text NOT NULL,
  "topicName" text NOT NULL,
  "topicDisplayOrder" integer,
  "text" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "topicOrder" integer,
  "questionOrder" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Question_row_kind_chk" CHECK (
    (
      "chatId" IS NULL
      AND "sourceQuestionId" IS NULL
      AND "topicOrder" IS NULL
      AND "questionOrder" IS NULL
    )
    OR
    (
      "chatId" IS NOT NULL
      AND "sourceQuestionId" IS NOT NULL
      AND "topicOrder" IS NOT NULL
      AND "questionOrder" IS NOT NULL
    )
  )
);--> statement-breakpoint

CREATE INDEX "Question_chatId_idx" ON "Question" ("chatId");--> statement-breakpoint
CREATE INDEX "Question_sourceQuestionId_idx" ON "Question" ("sourceQuestionId");--> statement-breakpoint
CREATE INDEX "Question_bank_topic_idx" ON "Question" ("topicDisplayOrder", "topicId") WHERE "chatId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Question_bank_topic_text_uq" ON "Question" ("topicId", "text") WHERE "chatId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "Question_chat_source_uq" ON "Question" ("chatId", "sourceQuestionId") WHERE "chatId" IS NOT NULL;--> statement-breakpoint

-- Bank rows keep their original UUIDs so every historical sourceQuestionId is
-- stable. A null chatId identifies a reusable bank row.
INSERT INTO "Question" (
  "id", "chatId", "sourceQuestionId", "topicId", "topicName",
  "topicDisplayOrder", "text", "isActive", "topicOrder",
  "questionOrder", "createdAt"
)
SELECT
  q."id", NULL, NULL, q."topicId", t."name", t."displayOrder",
  q."text", q."isActive", NULL, NULL, q."createdAt"
FROM "QuestionBank_0025" q
JOIN "Topic_0025" t ON t."id" = q."topicId";--> statement-breakpoint

-- Selected rows receive their own UUID and snapshot the topic/text that was
-- used in that chat. Chat.createdAt is the exact selection-time proxy because
-- selection occurs inside the same session-creation transaction.
INSERT INTO "Question" (
  "chatId", "sourceQuestionId", "topicId", "topicName",
  "topicDisplayOrder", "text", "isActive", "topicOrder",
  "questionOrder", "createdAt"
)
SELECT
  cq."chatId", cq."questionId", cq."topicId", t."name",
  t."displayOrder", cq."questionTextSnapshot", q."isActive",
  cq."topicOrder", cq."questionOrder", c."createdAt"
FROM "QuestionSelection_0025" cq
JOIN "QuestionBank_0025" q ON q."id" = cq."questionId"
JOIN "Topic_0025" t ON t."id" = cq."topicId"
JOIN "Chat" c ON c."id" = cq."chatId";--> statement-breakpoint

-- Abort rather than drop source tables if either copy lost a row.
DO $$
BEGIN
  IF (SELECT count(*) FROM "Question" WHERE "chatId" IS NULL)
     <> (SELECT count(*) FROM "QuestionBank_0025") THEN
    RAISE EXCEPTION 'Question bank copy count mismatch';
  END IF;
  IF (SELECT count(*) FROM "Question" WHERE "chatId" IS NOT NULL)
     <> (SELECT count(*) FROM "QuestionSelection_0025") THEN
    RAISE EXCEPTION 'Question selection copy count mismatch';
  END IF;
END
$$;--> statement-breakpoint

DROP TABLE "QuestionSelection_0025";--> statement-breakpoint
DROP TABLE "QuestionBank_0025";--> statement-breakpoint
DROP TABLE "Topic_0025";--> statement-breakpoint

-- 0023 locked down the pre-existing public schema. This table is new, so apply
-- the same deny-by-default RLS posture explicitly.
ALTER TABLE "Question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Question" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "Question" FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Efficient newest-first access plus explicit ordered views for Supabase
-- browsing. Base tables remain relationally unordered by PostgreSQL design.
CREATE INDEX "AgentSession_createdAt_desc_idx" ON "AgentSession" ("createdAt" DESC);--> statement-breakpoint
CREATE INDEX "ChatLogs_createdAt_desc_idx" ON "ChatLogs" ("createdAt" DESC);--> statement-breakpoint

CREATE VIEW "AgentSessionLatest"
WITH (security_invoker = true)
AS SELECT * FROM "AgentSession" ORDER BY "createdAt" DESC;--> statement-breakpoint
CREATE VIEW "ChatLogsLatest"
WITH (security_invoker = true)
AS SELECT * FROM "ChatLogs" ORDER BY "createdAt" DESC;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE "AgentSessionLatest", "ChatLogsLatest" FROM PUBLIC, anon, authenticated;
