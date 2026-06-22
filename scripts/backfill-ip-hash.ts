/**
 * One-off backfill: populate the hash columns (Chat.startIpHash,
 * Message_v2.ipHash) from the legacy raw IP columns (Chat.startIp,
 * Message_v2.ipAddress) BEFORE those raw columns are dropped in migration
 * 0021. Run AFTER 0020 (which adds the hash columns) and BEFORE 0021.
 *
 * Uses the same `hashIp` the request handlers use, so historical hashes match
 * hashes computed for new traffic — preserving "same IP → same hash" dedup for
 * the rows that already exist, without ever persisting the raw IP again.
 *
 * REQUIRES the same pepper that production uses (IP_HASH_PEPPER, falling back
 * to APP_PEPPER). Running with a different/empty pepper would produce hashes
 * that never match runtime hashes. Idempotent: only fills rows where the hash
 * is still NULL and a raw IP is present.
 *
 *   pnpm exec tsx scripts/backfill-ip-hash.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";
import { hashIp } from "@/lib/request-ip";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL required");
  }
  if (!(process.env.IP_HASH_PEPPER || process.env.APP_PEPPER)) {
    throw new Error(
      "IP_HASH_PEPPER or APP_PEPPER must be set so hashes match runtime"
    );
  }

  const sql = postgres(url, { max: 1 });
  try {
    // Confirm the columns exist (0020 applied, 0021 not yet).
    const cols = await sql<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('Chat','Message_v2')
        AND column_name IN ('startIp','ipAddress','startIpHash','ipHash')`;
    const names = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
    if (!(names.has("Chat.startIp") && names.has("Chat.startIpHash"))) {
      throw new Error(
        "Expected both Chat.startIp (legacy) and Chat.startIpHash (0020). " +
          "Run `pnpm db:migrate` to apply 0020 first, and do NOT run 0021 yet."
      );
    }

    const chats = await sql<Array<{ id: string; startIp: string }>>`
      SELECT id, "startIp" FROM "Chat"
      WHERE "startIp" IS NOT NULL AND "startIpHash" IS NULL`;
    let chatUpdated = 0;
    for (const row of chats) {
      await sql`
        UPDATE "Chat" SET "startIpHash" = ${hashIp(row.startIp)}
        WHERE id = ${row.id}`;
      chatUpdated += 1;
    }
    console.log(`Chat: backfilled ${chatUpdated} startIpHash`);

    const msgs = await sql<Array<{ id: string; ipAddress: string }>>`
      SELECT id, "ipAddress" FROM "Message_v2"
      WHERE "ipAddress" IS NOT NULL AND "ipHash" IS NULL`;
    let msgUpdated = 0;
    for (const row of msgs) {
      await sql`
        UPDATE "Message_v2" SET "ipHash" = ${hashIp(row.ipAddress)}
        WHERE id = ${row.id}`;
      msgUpdated += 1;
    }
    console.log(`Message_v2: backfilled ${msgUpdated} ipHash`);
    console.log("✓ backfill complete — safe to apply 0021 (drop raw columns)");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("backfill failed:", e);
  process.exit(1);
});
