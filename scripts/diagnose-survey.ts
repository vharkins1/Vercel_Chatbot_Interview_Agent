/**
 * Diagnostic (safe, read-only): dumps how the live Qualtrics survey is parsed
 * into agent-facing pages, and what recent agents actually submitted.
 *
 *   tsx scripts/diagnose-survey.ts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";
import { parsePages } from "@/lib/qualtrics/adapter";
import type { QualtricsSurveyDefinition } from "@/lib/qualtrics/client";

const SURVEY_ID = process.env.QUALTRICS_SURVEY_ID_STUDY1;
const POSTGRES_URL = process.env.POSTGRES_URL;
const QUALTRICS_TOKEN = process.env.QUALTRICS_API_TOKEN;
const QUALTRICS_DC = process.env.QUALTRICS_DATACENTER;

async function getSurveyDefinition(
  surveyId: string
): Promise<
  { ok: true; value: QualtricsSurveyDefinition } | { ok: false; reason: string }
> {
  if (!(QUALTRICS_TOKEN && QUALTRICS_DC)) {
    return { ok: false, reason: "not_configured" };
  }
  const res = await fetch(
    `https://${QUALTRICS_DC}.qualtrics.com/API/v3/survey-definitions/${surveyId}`,
    { headers: { "X-API-TOKEN": QUALTRICS_TOKEN } }
  );
  if (!res.ok) {
    return { ok: false, reason: `http_${res.status}: ${await res.text()}` };
  }
  const json = (await res.json()) as { result: QualtricsSurveyDefinition };
  return { ok: true, value: json.result };
}

async function dumpPages() {
  if (!SURVEY_ID) {
    console.log("⚠ QUALTRICS_SURVEY_ID_STUDY1 not set");
    return;
  }
  console.log(`\n=== SURVEY DEFINITION → parsePages (survey ${SURVEY_ID}) ===`);
  const def = await getSurveyDefinition(SURVEY_ID);
  if (!def.ok) {
    console.log("⚠ getSurveyDefinition failed:", JSON.stringify(def));
    return;
  }
  console.log(`Survey name: ${def.value.SurveyName}`);
  const pages = parsePages(def.value);
  console.log(`Total pages parsed: ${pages.length}\n`);
  for (const page of pages) {
    console.log(`── Page ${page.index} (${page.questions.length} q) ──`);
    for (const q of page.questions) {
      const promptPreview = q.prompt.replace(/\n/g, " ").slice(0, 90);
      if (q.type === "text") {
        console.log(
          `  [${q.qid}] TEXT key=${q.answerKey} :: "${promptPreview}"`
        );
      } else if (q.type === "choice") {
        console.log(
          `  [${q.qid}] CHOICE key=${q.answerKey} (${q.choices.length} choices) :: "${promptPreview}"`
        );
      } else if (q.type === "matrix_likert") {
        console.log(
          `  [${q.qid}] MATRIX rows=${q.rows.length} scale=${q.scale.length} :: "${promptPreview}"`
        );
      } else {
        console.log(
          `  [${q.qid}] SLIDER rows=${q.rows.length} [${q.min}..${q.max}] :: "${promptPreview}"`
        );
      }
    }
  }
}

async function dumpRecentAnswers() {
  if (!POSTGRES_URL) {
    console.log("\n⚠ POSTGRES_URL not set; skipping DB dump");
    return;
  }
  const sql = postgres(POSTGRES_URL, { max: 1 });
  try {
    console.log("\n=== RECENT SURVEY SUBMISSIONS (last 10) ===");
    const subs = await sql<
      Array<{
        chatId: string;
        status: string;
        currentPage: number;
        totalPages: number;
        partnerModel: string | null;
        partnerName: string | null;
        createdAt: Date;
      }>
    >`
      SELECT s."chatId", s.status, s."currentPage", s."totalPages",
             a."partnerModel", p.name AS "partnerName", s."createdAt"
      FROM "SurveySubmission" s
      LEFT JOIN "AgentSession" a ON a."chatId" = s."chatId"
      LEFT JOIN "PartnerAgent" p ON p.id = a."partnerAgentId"
      ORDER BY s."createdAt" DESC
      LIMIT 10`;
    for (const r of subs) {
      console.log(
        `  ${r.chatId.slice(0, 8)} status=${r.status} page=${r.currentPage}/${r.totalPages} model=${r.partnerModel} partner=${r.partnerName}`
      );
    }

    if (subs.length > 0) {
      console.log("\n=== ANSWERS FOR MOST RECENT SUBMISSION ===");
      const latest = subs[0].chatId;
      const answers = await sql<Array<{ qid: string; value: string }>>`
        SELECT qid, value FROM "SurveyAnswer"
        WHERE "chatId" = ${latest}
        ORDER BY qid`;
      console.log(`chatId=${latest} (${answers.length} answers)`);
      for (const a of answers) {
        console.log(`  ${a.qid} = ${JSON.stringify(a.value).slice(0, 80)}`);
      }
    }

    console.log("\n=== TEXT-ANSWER DISTINCTNESS (last 20 submissions) ===");
    const teStats = await sql<
      Array<{
        chatId: string;
        teCount: number;
        distinctValues: number;
        sample: string;
      }>
    >`
      WITH recent AS (
        SELECT "chatId" FROM "SurveySubmission"
        ORDER BY "createdAt" DESC LIMIT 20
      )
      SELECT sa."chatId",
             count(*)::int AS "teCount",
             count(DISTINCT sa.value)::int AS "distinctValues",
             min(sa.value) AS sample
      FROM "SurveyAnswer" sa
      JOIN recent r ON r."chatId" = sa."chatId"
      WHERE sa.qid LIKE '%\\_TEXT'
      GROUP BY sa."chatId"
      ORDER BY sa."chatId"`;
    for (const r of teStats) {
      const flag =
        r.teCount > 1 && r.distinctValues === 1 ? "  ⚠ ALL-SAME" : "";
      console.log(
        `  ${r.chatId.slice(0, 8)}: ${r.teCount} TE answers, ${r.distinctValues} distinct — e.g. ${JSON.stringify(r.sample).slice(0, 50)}${flag}`
      );
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  await dumpPages();
  await dumpRecentAnswers();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
