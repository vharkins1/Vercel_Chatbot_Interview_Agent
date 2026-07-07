import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required");
  }

  const sql = postgres(url);
  try {
    const rows = await sql`
      SELECT
        started_at,
        completed_at,
        partner,
        participant,
        condition,
        title,
        prompt_id,
        prompt_version,
        total_tokens,
        turns,
        chat_id
      FROM "SessionOverview"
      ORDER BY started_at DESC
    `;

    if (rows.length === 0) {
      process.stderr.write("no sessions found\n");
      return;
    }

    const headers = Object.keys(rows[0]);
    process.stdout.write(`${headers.join(",")}\n`);
    for (const row of rows) {
      const line = headers.map((h) => {
        const v = (row as Record<string, unknown>)[h];
        if (v === null || v === undefined) {
          return "";
        }
        if (v instanceof Date) {
          return csvEscape(v);
        }
        if (typeof v === "object") {
          return csvEscape(JSON.stringify(v));
        }
        return csvEscape(v);
      });
      process.stdout.write(`${line.join(",")}\n`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
