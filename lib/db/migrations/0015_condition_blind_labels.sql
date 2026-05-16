ALTER TABLE "AgentSession" ADD COLUMN "conditionLabel" text;--> statement-breakpoint
ALTER TABLE "Invitation" ADD COLUMN "conditionLabel" text;--> statement-breakpoint

-- Backfill labels from the old condition values, then rewrite condition to A/B/C.
UPDATE "AgentSession" SET "conditionLabel" = "condition" WHERE "condition" IN ('positive','neutral','negative','disconfirmatory');--> statement-breakpoint
UPDATE "AgentSession" SET "condition" = CASE
  WHEN "condition" = 'positive' THEN 'A'
  WHEN "condition" = 'neutral' THEN 'B'
  WHEN "condition" IN ('negative','disconfirmatory') THEN 'C'
  ELSE "condition"
END WHERE "condition" IN ('positive','neutral','negative','disconfirmatory');--> statement-breakpoint

UPDATE "Invitation" SET "conditionLabel" = "condition" WHERE "condition" IN ('positive','neutral','negative','disconfirmatory');--> statement-breakpoint
UPDATE "Invitation" SET "condition" = CASE
  WHEN "condition" = 'positive' THEN 'A'
  WHEN "condition" = 'neutral' THEN 'B'
  WHEN "condition" IN ('negative','disconfirmatory') THEN 'C'
  ELSE "condition"
END WHERE "condition" IN ('positive','neutral','negative','disconfirmatory');
