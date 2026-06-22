/**
 * How many participants have we run since the sequential counter started?
 *
 *   pnpm db:count-participants
 *
 * `seq` is the monotonic participant number stamped on each AgentSession at
 * creation (migration 0019). Rows created before the counter existed are NULL
 * and are excluded here. Splits the count by agent vs. human and by whether the
 * Qualtrics survey was actually submitted.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL not set");
  }
  const sql = postgres(url, { max: 1 });
  try {
    const [overall] = await sql<
      Array<{ counted: number; minSeq: number | null; maxSeq: number | null }>
    >`
      SELECT count(seq)::int AS counted,
             min(seq)::int AS "minSeq",
             max(seq)::int AS "maxSeq"
      FROM "AgentSession"`;

    console.log("── Participants (sequential counter) ─────────────");
    console.log(`  total numbered:   ${overall.counted}`);
    console.log(
      `  seq range:        ${overall.minSeq ?? "—"} … ${overall.maxSeq ?? "—"}`
    );

    const bySource = await sql<
      Array<{ source: string; n: number; submitted: number }>
    >`
      SELECT CASE WHEN a."partnerAgentId" IS NULL THEN 'human' ELSE 'agent' END AS source,
             count(a.seq)::int AS n,
             count(s."chatId") FILTER (WHERE s.status = 'submitted')::int AS submitted
      FROM "AgentSession" a
      LEFT JOIN "SurveySubmission" s ON s."chatId" = a."chatId"
      WHERE a.seq IS NOT NULL
      GROUP BY 1
      ORDER BY 1`;
    console.log("\n  by source:");
    for (const r of bySource) {
      console.log(
        `    ${r.source.padEnd(6)}  ${r.n} numbered, ${r.submitted} survey-submitted`
      );
    }

    const recent = await sql<
      Array<{
        seq: number;
        chatId: string;
        partner: string | null;
        status: string | null;
        createdAt: Date;
      }>
    >`
      SELECT a.seq, a."chatId", p.name AS partner, s.status, a."createdAt"
      FROM "AgentSession" a
      LEFT JOIN "PartnerAgent" p ON p.id = a."partnerAgentId"
      LEFT JOIN "SurveySubmission" s ON s."chatId" = a."chatId"
      WHERE a.seq IS NOT NULL
      ORDER BY a.seq DESC
      LIMIT 10`;
    console.log("\n  last 10:");
    for (const r of recent) {
      console.log(
        `    #${String(r.seq).padStart(4)}  ${r.chatId.slice(0, 8)}  ${(r.partner ?? "human").padEnd(28)}  survey=${r.status ?? "—"}`
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
