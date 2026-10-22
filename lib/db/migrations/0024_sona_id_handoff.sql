-- Preserve the SONA participant id across the Qualtrics → interview →
-- Qualtrics handoff. This is distinct from the pre-survey StudyID.
ALTER TABLE "AgentSession" ADD COLUMN IF NOT EXISTS "sonaId" text;
