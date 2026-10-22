CREATE SCHEMA IF NOT EXISTS private;--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS private."RuntimePrompt" (
  "key" text PRIMARY KEY NOT NULL,
  "content" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, anon, authenticated;
