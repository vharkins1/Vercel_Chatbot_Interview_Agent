import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }
  const sql = postgres(url);
  try {
    const rows =
      await sql`SELECT id, name, "createdAt", "lastUsedAt", "revokedAt" FROM "PartnerAgent" ORDER BY "createdAt"`;
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
