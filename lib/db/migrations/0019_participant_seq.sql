-- Participant sequence counter on AgentSession.
--
-- A monotonic, human-friendly participant number (1, 2, 3, …) assigned DB-side
-- on insert via a dedicated Postgres sequence. Existing sessions stay NULL — we
-- add the column WITHOUT a default first, then attach the default, so the
-- volatile nextval() does NOT backfill historical rows. The counter therefore
-- starts at 1 with the first session created after this migration ("since we
-- started the sequential runs"). Surfaced to partners on the AgentSession DTO
-- and pushed to Qualtrics as the `participant_seq` embedded-data field.

CREATE SEQUENCE IF NOT EXISTS "AgentSession_seq_seq" START WITH 1 INCREMENT BY 1;--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "AgentSession" ALTER COLUMN "seq" SET DEFAULT nextval('"AgentSession_seq_seq"');
