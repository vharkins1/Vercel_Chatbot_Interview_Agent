ALTER TABLE "AgentSession" RENAME COLUMN "modelReported" TO "interviewerModel";--> statement-breakpoint
ALTER TABLE "AgentSession" DROP COLUMN "modelSelfDeclared";--> statement-breakpoint
ALTER TABLE "AgentSession" ADD COLUMN "partnerModel" text;
