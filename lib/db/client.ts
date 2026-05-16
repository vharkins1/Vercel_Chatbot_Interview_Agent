import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// `prepare: false` is required when POSTGRES_URL points at Supabase's
// transaction-mode pooler (port 6543) — that pooler does not maintain
// prepared statements across rotated backend connections, so leaving
// prepares on causes intermittent stale-snapshot reads and FK-violation
// errors right after a fresh INSERT commits.
const client = postgres(process.env.POSTGRES_URL ?? "", { prepare: false });
export const db = drizzle(client);
