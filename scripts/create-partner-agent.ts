import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { partnerAgent } from "../lib/db/schema";

config({ path: ".env.local" });

function hashApiKey(raw: string): string {
  const pepper = process.env.APP_PEPPER ?? "";
  return createHash("sha256")
    .update(raw + pepper)
    .digest("hex");
}

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: tsx scripts/create-partner-agent.ts <name>");
    process.exit(1);
  }

  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is required");
  if (!process.env.APP_PEPPER) throw new Error("APP_PEPPER is required");

  const rawKey = randomBytes(32).toString("base64url");
  const keyHash = hashApiKey(rawKey);

  const sql = postgres(url);
  const db = drizzle(sql);

  try {
    const [row] = await db
      .insert(partnerAgent)
      .values({ name, keyHash })
      .returning({ id: partnerAgent.id, name: partnerAgent.name });

    console.log(`created partner agent: ${row.name} (${row.id})`);
    console.log("");
    console.log("API key (shown once — capture and share OOB):");
    console.log(rawKey);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
