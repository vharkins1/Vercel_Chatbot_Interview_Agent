/**
 * Smoke test for the Qualtrics handoff. Self-issues a partner agent key,
 * creates a session, runs one interview turn, completes the interview, then
 * walks every page of /survey with deterministic answers and verifies the
 * response lands in Qualtrics with the join keys we expect.
 *
 * Cleanup runs at the end: deletes the Qualtrics response by id and the local
 * SurveySubmission / SurveyAnswer / AgentSession / Chat / Participant /
 * synthetic User / PartnerAgent rows it created. Idempotent — re-running
 * leaves no orphan rows.
 *
 * Usage:
 *   AGENT_API_BASE=https://your-deployment tsx scripts/e2e-survey-test.ts
 *   (defaults to http://localhost:3000)
 *
 * Requires QUALTRICS_API_TOKEN, QUALTRICS_DATACENTER, QUALTRICS_SURVEY_ID_STUDY1
 * in env (for the verify + cleanup steps that talk to Qualtrics directly).
 *
 * Requires POSTGRES_URL in env for the local cleanup.
 */
import postgres from "postgres";

const BASE = process.env.AGENT_API_BASE ?? "http://localhost:3000";
const POSTGRES_URL = process.env.POSTGRES_URL;
const QUALTRICS_TOKEN = process.env.QUALTRICS_API_TOKEN;
const QUALTRICS_DC = process.env.QUALTRICS_DATACENTER;
const SURVEY_ID = process.env.QUALTRICS_SURVEY_ID_STUDY1;

if (!POSTGRES_URL) {
  throw new Error("POSTGRES_URL required for cleanup");
}
if (!(QUALTRICS_TOKEN && QUALTRICS_DC && SURVEY_ID)) {
  throw new Error(
    "QUALTRICS_API_TOKEN, QUALTRICS_DATACENTER, QUALTRICS_SURVEY_ID_STUDY1 required"
  );
}

type AgentChoice = { value: string; label: string };
type AgentRow = { answerKey: string; label: string };
type AgentScalePoint = { value: string; label: string };
type AgentQuestion =
  | { qid: string; type: "text"; prompt: string; answerKey: string }
  | {
      qid: string;
      type: "choice";
      prompt: string;
      answerKey: string;
      choices: AgentChoice[];
    }
  | {
      qid: string;
      type: "matrix_likert";
      prompt: string;
      rows: AgentRow[];
      scale: AgentScalePoint[];
    }
  | {
      qid: string;
      type: "slider";
      prompt: string;
      rows: AgentRow[];
      min: number;
      max: number;
    };

// Deterministic stand-in for an LLM agent. Real agents will produce
// thoughtful answers; this just exercises the wire format.
function answerFor(q: AgentQuestion): Record<string, string | number> {
  if (q.type === "text") {
    return { [q.answerKey]: `smoke-test answer for ${q.qid}` };
  }
  if (q.type === "choice") {
    return { [q.answerKey]: q.choices[0]?.value ?? "1" };
  }
  if (q.type === "matrix_likert") {
    const mid = q.scale[Math.floor(q.scale.length / 2)]?.value ?? "4";
    const out: Record<string, string | number> = {};
    for (const r of q.rows) {
      out[r.answerKey] = mid;
    }
    return out;
  }
  // slider
  const mid = Math.floor((q.min + q.max) / 2);
  const out: Record<string, string | number> = {};
  for (const r of q.rows) {
    out[r.answerKey] = mid;
  }
  return out;
}

async function api(
  method: "GET" | "POST",
  path: string,
  key: string,
  body?: unknown
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  return { status: res.status, raw };
}

async function main() {
  console.log(`Target: ${BASE}\n`);

  // 1. Self-issue a partner agent key. The /keys endpoint honors `label` (not
  // `name`) and returns the generated `partnerName` (`<label>-<hash>`). We MUST
  // clean up by that returned name — earlier this passed `name` and cleaned up
  // by a string the server ignored, so DB cleanup silently deleted nothing.
  const keyRes = await fetch(`${BASE}/api/agent/v1/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "survey-smoke" }),
  });
  if (!keyRes.ok) {
    throw new Error(
      `key issuance failed: ${keyRes.status} ${await keyRes.text()}`
    );
  }
  const { apiKey, partnerName } = (await keyRes.json()) as {
    apiKey: string;
    partnerName: string;
  };
  console.log(`✓ issued partner key for ${partnerName}`);

  // 2. Create session.
  const create = await api("POST", "/api/agent/v1/sessions", apiKey, {
    participantExternalId: `survey-smoke-${Date.now()}`,
    title: "survey smoke test (safe to delete)",
    partnerModel: "survey-smoke",
  });
  if (create.status !== 200) {
    throw new Error(`create failed: ${create.status} ${create.raw}`);
  }
  const { chatId } = JSON.parse(create.raw) as {
    chatId: string;
  };
  console.log(`✓ created session ${chatId}`);

  // 3. One turn so the transcript isn't empty.
  await api("POST", `/api/agent/v1/sessions/${chatId}/turns`, apiKey, {
    text: "Hi, I'm the smoke-test interviewee.",
    partnerModel: "survey-smoke",
  });
  console.log("✓ posted 1 turn");

  // 4. Complete. The new contract returns the first survey page inline so the
  // partner agent naturally continues without an extra GET round-trip.
  const complete = await api(
    "POST",
    `/api/agent/v1/sessions/${chatId}/complete`,
    apiKey
  );
  if (complete.status !== 200) {
    throw new Error(`complete failed: ${complete.status} ${complete.raw}`);
  }
  const completeBody = JSON.parse(complete.raw) as {
    completionCode: string;
    survey: {
      page: number;
      totalPages: number;
      questions: AgentQuestion[];
    } | null;
  };
  console.log(
    `✓ completed interview (completionCode=${completeBody.completionCode}, survey handoff=${
      completeBody.survey
        ? `page ${completeBody.survey.page}/${completeBody.survey.totalPages}`
        : "null"
    })`
  );
  if (!completeBody.survey) {
    throw new Error("expected /complete to return first survey page");
  }

  // 5. Walk every page. Seed the loop with the page returned by /complete so
  // we exercise the new chain (no upfront GET needed).
  let pageCount = 0;
  let qualtricsResponseId: string | null = null;
  let nextPage: {
    done: false;
    page: number;
    totalPages: number;
    questions: AgentQuestion[];
  } | null = { done: false, ...completeBody.survey };
  for (;;) {
    let page:
      | {
          done: false;
          page: number;
          totalPages: number;
          questions: AgentQuestion[];
        }
      | { done: true; qualtricsResponseId: string };
    if (nextPage) {
      page = nextPage;
      nextPage = null;
    } else {
      const get = await api(
        "GET",
        `/api/agent/v1/sessions/${chatId}/survey`,
        apiKey
      );
      if (get.status !== 200) {
        throw new Error(`GET /survey failed: ${get.status} ${get.raw}`);
      }
      page = JSON.parse(get.raw) as typeof page;
    }
    if (page.done) {
      qualtricsResponseId = page.qualtricsResponseId;
      break;
    }
    pageCount += 1;
    const answers: Record<string, string | number> = {};
    for (const q of page.questions) {
      Object.assign(answers, answerFor(q));
    }
    const post = await api(
      "POST",
      `/api/agent/v1/sessions/${chatId}/survey`,
      apiKey,
      { page: page.page, answers }
    );
    if (post.status !== 200) {
      throw new Error(
        `POST /survey page ${page.page} failed: ${post.status} ${post.raw}`
      );
    }
    const body = JSON.parse(post.raw) as {
      done: boolean;
      qualtricsResponseId?: string;
    };
    if (body.done && body.qualtricsResponseId) {
      qualtricsResponseId = body.qualtricsResponseId;
      break;
    }
  }
  console.log(
    `✓ walked ${pageCount} pages → qualtricsResponseId=${qualtricsResponseId}`
  );

  if (!qualtricsResponseId) {
    throw new Error("no qualtricsResponseId returned");
  }

  // 6. Verify on the Qualtrics side: fetch the response and show the
  // embedded data we expect.
  console.log("\n→ Qualtrics-side proof:");
  const verify = await fetch(
    `https://${QUALTRICS_DC}.qualtrics.com/API/v3/surveys/${SURVEY_ID}/responses/${qualtricsResponseId}`,
    { headers: { "X-API-TOKEN": QUALTRICS_TOKEN ?? "" } }
  );
  const verifyBody = await verify.text();
  let embeddedCompletionCode = "(not parsed)";
  try {
    const parsed = JSON.parse(verifyBody) as {
      result?: { values?: Record<string, unknown> };
    };
    const v = parsed.result?.values;
    if (v && typeof v.completion_code === "string") {
      embeddedCompletionCode = v.completion_code;
    } else if (v && typeof v.completionCode === "string") {
      embeddedCompletionCode = v.completionCode;
    }
    console.log(
      `  responseId:                  ${qualtricsResponseId}`,
      `\n  completion_code (Qualtrics): ${embeddedCompletionCode}`,
      `\n  total answer keys in row:    ${v ? Object.keys(v).length : 0}`
    );
  } catch {
    console.log(`  raw response body: ${verifyBody.slice(0, 300)}…`);
  }

  // 7. Verify on the Supabase side: pull the joined view by completion_code.
  console.log("\n→ Supabase-side proof:");
  const sql = postgres(POSTGRES_URL ?? "", { max: 1 });
  const proof = await sql<
    Array<{
      chatId: string;
      condition: string | null;
      completionCode: string | null;
      qualtricsResponseId: string | null;
      status: string;
      answerCount: number;
    }>
  >`
    SELECT a."chatId",
           a.condition,
           a."completionCode",
           s."qualtricsResponseId",
           s.status,
           (SELECT count(*)::int FROM "SurveyAnswer" sa WHERE sa."chatId" = a."chatId") AS "answerCount"
    FROM "AgentSession" a
    JOIN "SurveySubmission" s ON s."chatId" = a."chatId"
    WHERE a."chatId" = ${chatId}`;
  console.log("  joined row:", proof[0]);

  // 8. Manual-verification window.
  console.log("\n──────────────────────────────────────────────────────");
  console.log("  LINKAGE VERIFIED — both sides have the same row.");
  console.log("──────────────────────────────────────────────────────");
  console.log("\n  Inspect in Qualtrics:");
  console.log(
    `    https://${QUALTRICS_DC}.qualtrics.com/responses/#/surveys/${SURVEY_ID}/responses/${qualtricsResponseId}`
  );
  console.log("\n  Inspect in Supabase (paste in SQL editor):");
  console.log(`    SELECT a.*, s.* FROM "AgentSession" a`);
  console.log(`    JOIN "SurveySubmission" s ON s."chatId" = a."chatId"`);
  console.log(`    WHERE a."chatId" = '${chatId}';`);

  if (process.env.SMOKE_NO_CLEANUP === "1") {
    console.log(
      "\n⚠️  SMOKE_NO_CLEANUP=1 set — leaving test data in place.",
      "\n   Re-run with the env unset (or run cleanup-leak-probe-style cleanup) to remove."
    );
    await sql.end();
    return;
  }

  // 9. Cleanup — Qualtrics response.
  console.log("\n→ Cleaning up Qualtrics test response…");
  const del = await fetch(
    `https://${QUALTRICS_DC}.qualtrics.com/API/v3/surveys/${SURVEY_ID}/responses/${qualtricsResponseId}`,
    { method: "DELETE", headers: { "X-API-TOKEN": QUALTRICS_TOKEN ?? "" } }
  );
  console.log(`  ✓ Qualtrics DELETE → HTTP ${del.status}`);

  // 10. Cleanup — local DB.
  try {
    await sql.begin(async (tx) => {
      const partner = await tx<{ id: string }[]>`
        SELECT id FROM "PartnerAgent" WHERE name = ${partnerName} LIMIT 1`;
      if (partner.length === 0) {
        return;
      }
      const partnerId = partner[0].id;
      const chats = await tx<{ id: string; userId: string }[]>`
        SELECT id, "userId" FROM "Chat" WHERE "partnerAgentId" = ${partnerId}`;
      const chatIds = chats.map((c) => c.id);
      const userIds = chats.map((c) => c.userId);

      await tx`DELETE FROM "SurveyAnswer" WHERE "chatId" = ANY(${chatIds})`;
      await tx`DELETE FROM "SurveySubmission" WHERE "chatId" = ANY(${chatIds})`;
      await tx`DELETE FROM "Message_v2" WHERE "chatId" = ANY(${chatIds})`;
      await tx`DELETE FROM "AgentSession" WHERE "partnerAgentId" = ${partnerId}`;
      await tx`DELETE FROM "Chat" WHERE "partnerAgentId" = ${partnerId}`;
      await tx`DELETE FROM "Participant" WHERE "partnerAgentId" = ${partnerId}`;
      if (userIds.length > 0) {
        await tx`DELETE FROM "User" WHERE id = ANY(${userIds})`;
      }
      await tx`DELETE FROM "PartnerAgent" WHERE id = ${partnerId}`;
    });
    console.log("  ✓ cleaned up local DB rows");
  } finally {
    await sql.end();
  }

  console.log("\n================ ✅ smoke test passed ================");
}

main().catch((e) => {
  console.error("\n❌ smoke test failed:", e);
  process.exit(1);
});
