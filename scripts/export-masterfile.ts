/**
 * Master file export — one row per AGENT interview session, joining the
 * Supabase side to its Qualtrics linkage so the team has a single spreadsheet
 * for analysis (the deliverable the 6/13 meeting kept describing).
 *
 * Each row carries the join keys that tie the two systems together
 * (chat_id / completion_code / participant_seq / qualtrics_response_id) plus
 * the study arm. The condition is included BOTH blinded (A/B/C) and as the
 * real label (positive/neutral/disconfirmatory): this is a STAFF-ONLY DB
 * artifact the interviewee never sees, so the explicit label is fine here and
 * useful for analysis. That is exactly why it is written into `transcripts/`,
 * which is gitignored (like the other unblinded exports) — do NOT move this
 * output anywhere committable.
 *
 * Agents only for now: humans have no SurveySubmission/qualtrics_response_id
 * yet, so the human side is deliberately deferred (filter: partnerAgentId IS
 * NOT NULL).
 *
 *   pnpm db:export-masterfile
 *   pnpm db:export-masterfile --out transcripts/custom.csv
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";

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

function outPath(): string {
  const flagIdx = process.argv.indexOf("--out");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return process.argv[flagIdx + 1];
  }
  const date = new Date().toISOString().slice(0, 10);
  return `transcripts/masterfile_${date}.csv`;
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
        a."chatId"                                   AS chat_id,
        a.seq                                        AS participant_seq,
        p.name                                       AS partner,
        a."partnerModel"                             AS partner_model,
        a."interviewerModel"                         AS interviewer_model,
        a.condition                                  AS condition,
        a."conditionLabel"                           AS condition_label,
        a."completionCode"                           AS completion_code,
        s."qualtricsResponseId"                      AS qualtrics_response_id,
        s.status                                     AS survey_status,
        s."totalPages"                               AS survey_pages,
        a."promptId"                                 AS prompt_id,
        a."promptVersion"                            AS prompt_version,
        a."totalTokens"                              AS total_tokens,
        (
          SELECT count(*)::int FROM "Message_v2" m
          WHERE m."chatId" = a."chatId" AND m.role = 'user'
        )                                            AS interviewee_turns,
        a."createdAt"                                AS created_at,
        a."completedAt"                              AS completed_at,
        s."submittedAt"                              AS survey_submitted_at
      FROM "AgentSession" a
      LEFT JOIN "SurveySubmission" s ON s."chatId" = a."chatId"
      LEFT JOIN "PartnerAgent" p ON p.id = a."partnerAgentId"
      WHERE a."partnerAgentId" IS NOT NULL
      ORDER BY a."createdAt" DESC
    `;

    if (rows.length === 0) {
      process.stderr.write("no agent sessions found\n");
      return;
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => csvEscape((row as Record<string, unknown>)[h]))
          .join(",")
      );
    }

    const path = outPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${lines.join("\n")}\n`);

    const linked = rows.filter((r) => r.qualtrics_response_id).length;
    process.stderr.write(
      `wrote ${rows.length} agent sessions to ${path}\n` +
        `  ${linked} have a Qualtrics response id (linked end-to-end)\n` +
        "  contains UNBLINDED condition labels — keep in transcripts/ (gitignored)\n"
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
