import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { partnerAgent } from "../lib/db/schema";

config({ path: ".env.local" });

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: tsx scripts/unrevoke-partner.ts <name>");
    process.exit(1);
  }

  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url);
  const db = drizzle(sql);
  try {
    const [row] = await db
      .update(partnerAgent)
      .set({ revokedAt: null })
      .where(eq(partnerAgent.name, name))
      .returning({ id: partnerAgent.id, name: partnerAgent.name });
    console.log(
      row ? `unrevoked: ${row.name} (${row.id})` : `no partner named "${name}"`
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
