-- Keep all application data server-only. Supabase's Data API executes
-- unauthenticated and signed-in requests as the anon and authenticated roles.
-- Drizzle connects as postgres, which has BYPASSRLS, so server-side access is
-- preserved while every Data API role is denied by both privileges and RLS.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- RLS without policies is deny-by-default. Apply it to every current base table,
-- including any table created manually outside the checked-in migrations.
DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', relation.qualified_name);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', relation.qualified_name);
  END LOOP;
END
$$;