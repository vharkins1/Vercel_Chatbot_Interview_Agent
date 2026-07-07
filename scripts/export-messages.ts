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

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  const out: string[] = [];
  for (const p of parts as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") {
      continue;
    }
    const type = String(p.type ?? "");
    if (type === "text" && typeof p.text === "string") {
      out.push(p.text);
    } else if (
      type.startsWith("tool-") ||
      type === "tool-call" ||
      type === "tool-result"
    ) {
      out.push(`[${type}] ${JSON.stringify(p)}`);
    } else if (type === "reasoning" && typeof p.text === "string") {
      out.push(`[reasoning] ${p.text}`);
    } else {
      out.push(`[${type}]`);
    }
  }
  return out.join("\n");
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
        m."chatId"     AS chat_id,
        c."title"      AS chat_title,
        m."createdAt"  AS created_at,
        m."role"       AS role,
        m."parts"      AS parts
      FROM "Message_v2" m
      JOIN "Chat" c ON c.id = m."chatId"
      ORDER BY m."chatId", m."createdAt" ASC
    `;

    const headers = [
      "chat_id",
      "chat_title",
      "created_at",
      "role",
      "text",
      "parts_json",
    ];
    process.stdout.write(`${headers.join(",")}\n`);
    for (const r of rows as Record<string, unknown>[]) {
      const line = [
        csvEscape(r.chat_id),
        csvEscape(r.chat_title),
        csvEscape(r.created_at),
        csvEscape(r.role),
        csvEscape(extractText(r.parts)),
        csvEscape(JSON.stringify(r.parts)),
      ];
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
