/**
 * Hardened end-to-end TRACING test. Proves a single (deterministically
 * simulated) Moltbook-shaped agent interview is traceable as ONE identity
 * across BOTH Supabase and Qualtrics.
 *
 * Forked from scripts/e2e-survey-test.ts. The difference from the smoke test is
 * that this script makes REAL assertions that THROW on mismatch (the smoke test
 * only printed a "LINKAGE VERIFIED" banner without asserting equality), and it
 * proves the linkage in BOTH directions:
 *   - forward: AgentSession/SurveySubmission/Message_v2 rows agree with each
 *     other and with the Qualtrics embedded data, and
 *   - reverse: re-querying Supabase using ONLY the Qualtrics-supplied chat_id
 *     (and separately the unique completion_code) resolves to exactly the same
 *     AgentSession.
 *
 * The agent is simulated deterministically — like the canned smoke test, this
 * does NOT call a real external Moltbook agent.
 *
 * Cleanup runs in a finally block so it ALWAYS executes even when an assertion
 * throws (the smoke test leaked rows on failure). Cleanup deletes the Qualtrics
 * response by id and the local rows it created, looked up by the returned
 * partnerName (the corrected label-based path — looking up by an ignored `name`
 * field silently no-op'd in an earlier version). Idempotent.
 *
 * Usage:
 *   AGENT_API_BASE=https://your-deployment tsx scripts/trace-agent-e2e.ts
 *   (defaults to http://localhost:3000)
 *   SMOKE_NO_CLEANUP=1 leaves the created rows + Qualtrics response in place.
 *
 * Requires QUALTRICS_API_TOKEN, QUALTRICS_DATACENTER, QUALTRICS_SURVEY_ID_STUDY1
 * (for the Qualtrics read + delete) and POSTGRES_URL (for the Supabase
 * assertions + cleanup).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import postgres from "postgres";

const BASE = process.env.AGENT_API_BASE ?? "http://localhost:3000";
const POSTGRES_URL = process.env.POSTGRES_URL;
const QUALTRICS_TOKEN = process.env.QUALTRICS_API_TOKEN;
const QUALTRICS_DC = process.env.QUALTRICS_DATACENTER;
const SURVEY_ID = process.env.QUALTRICS_SURVEY_ID_STUDY1;

// A Moltbook-shaped partner model string. The exact value is asserted to round
// trip through AgentSession.partnerModel and every user-turn Message_v2 row.
const PARTNER_MODEL = "moltbook/agent-v1";

if (!POSTGRES_URL) {
  throw new Error("POSTGRES_URL required for assertions + cleanup");
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
    return { [q.answerKey]: `trace-test answer for ${q.qid}` };
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

// Mirrors lib/qualtrics/client.ts `getResponse`. The client module is
// `server-only` and cannot be imported at runtime into a tsx script (see
// scripts/diagnose-survey.ts, which re-implements its fetch the same way), so
// we inline the same X-API-TOKEN + datacenter base-URL request here.
async function qualtricsGetResponse(
  responseId: string
): Promise<{ values: Record<string, unknown> }> {
  const res = await fetch(
    `https://${QUALTRICS_DC}.qualtrics.com/API/v3/surveys/${SURVEY_ID}/responses/${responseId}`,
    { headers: { "X-API-TOKEN": QUALTRICS_TOKEN ?? "" } }
  );
  if (!res.ok) {
    throw new Error(
      `Qualtrics getResponse failed: HTTP ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as {
    result?: { values?: Record<string, unknown> };
  };
  return { values: json.result?.values ?? {} };
}

// Inline Qualtrics response DELETE (this script is standalone; it does not
// import lib/qualtrics/client.ts).
async function qualtricsDeleteResponse(responseId: string): Promise<number> {
  const res = await fetch(
    `https://${QUALTRICS_DC}.qualtrics.com/API/v3/surveys/${SURVEY_ID}/responses/${responseId}`,
    { method: "DELETE", headers: { "X-API-TOKEN": QUALTRICS_TOKEN ?? "" } }
  );
  return res.status;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `assertion failed [${label}]: expected ${JSON.stringify(
        expected
      )}, got ${JSON.stringify(actual)}`
    );
  }
}

function assert(label: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`assertion failed [${label}]`);
  }
}

type DriveResult = {
  chatId: string;
  completionCode: string;
  qualtricsResponseId: string;
  participantExternalId: string;
};

// Self-issue a key + drive a full interview → survey. Returns the join keys.
async function drive(): Promise<
  { apiKey: string; partnerName: string } & DriveResult
> {
  // 1. Self-issue a partner agent key. The /keys endpoint honors `label` (not
  // `name`) and returns the generated `partnerName` (`<label>-<hash>`). Cleanup
  // MUST use that returned name.
  const keyRes = await fetch(`${BASE}/api/agent/v1/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "trace-moltbook" }),
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

  // 2. Create session with a Moltbook-shaped partnerModel + unique externalId.
  const participantExternalId = `trace-moltbook-${Date.now()}`;
  const create = await api("POST", "/api/agent/v1/sessions", apiKey, {
    participantExternalId,
    title: "trace agent e2e (safe to delete)",
    partnerModel: PARTNER_MODEL,
  });
  if (create.status !== 200) {
    throw new Error(`create failed: ${create.status} ${create.raw}`);
  }
  // The create response is intentionally blinded — it carries NO condition.
  // The study arm is recovered staff-side via the chat_id join, never on the
  // wire to a participant/partner.
  const { chatId } = JSON.parse(create.raw) as { chatId: string };
  console.log(`✓ created session ${chatId}`);

  // 3. At least 2 turns so the transcript is non-trivial.
  for (const text of [
    "Hi, I'm the trace-test interviewee.",
    "Here is a second turn from the same interviewee.",
  ]) {
    const turn = await api(
      "POST",
      `/api/agent/v1/sessions/${chatId}/turns`,
      apiKey,
      { text, partnerModel: PARTNER_MODEL }
    );
    if (turn.status !== 200) {
      throw new Error(`turn failed: ${turn.status} ${turn.raw}`);
    }
  }
  console.log("✓ posted 2 turns");

  // 4. Complete — returns the first survey page inline.
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
  if (!completeBody.survey) {
    throw new Error("expected /complete to return first survey page");
  }
  console.log(
    `✓ completed interview (completionCode=${completeBody.completionCode}, survey page ${completeBody.survey.page}/${completeBody.survey.totalPages})`
  );

  // 5. Walk every page, seeding the loop with the page from /complete.
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
  if (!qualtricsResponseId) {
    throw new Error("no qualtricsResponseId returned");
  }
  console.log(
    `✓ walked ${pageCount} pages → qualtricsResponseId=${qualtricsResponseId}`
  );

  return {
    apiKey,
    partnerName,
    chatId,
    completionCode: completeBody.completionCode,
    qualtricsResponseId,
    participantExternalId,
  };
}

async function cleanup(
  sql: ReturnType<typeof postgres>,
  partnerName: string,
  qualtricsResponseId: string | null
): Promise<void> {
  if (process.env.SMOKE_NO_CLEANUP === "1") {
    console.log(
      "\n⚠️  SMOKE_NO_CLEANUP=1 set — leaving test data + Qualtrics response in place."
    );
    return;
  }

  if (qualtricsResponseId) {
    console.log("\n→ Cleaning up Qualtrics test response…");
    try {
      const status = await qualtricsDeleteResponse(qualtricsResponseId);
      console.log(`  ✓ Qualtrics DELETE → HTTP ${status}`);
    } catch (e) {
      console.error("  ⚠️  Qualtrics delete failed:", e);
    }
  }

  console.log("→ Cleaning up local DB rows…");
  // FK-safe order: SurveyAnswer → SurveySubmission → Message_v2 →
  // AgentSession → Chat → Participant → synthetic User → PartnerAgent.
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
}

async function main() {
  console.log(`Target: ${BASE}\n`);

  const sql = postgres(POSTGRES_URL ?? "", { max: 1 });
  let partnerName: string | null = null;
  let qualtricsResponseId: string | null = null;

  try {
    const driven = await drive();
    partnerName = driven.partnerName;
    qualtricsResponseId = driven.qualtricsResponseId;
    const { chatId, completionCode, participantExternalId } = driven;

    // ── Supabase side ────────────────────────────────────────────
    console.log("\n→ Supabase-side reads:");
    const sessions = await sql<
      Array<{
        chatId: string;
        seq: number | null;
        completionCode: string | null;
        partnerModel: string | null;
      }>
    >`
      SELECT "chatId", seq, "completionCode", "partnerModel"
      FROM "AgentSession" WHERE "chatId" = ${chatId}`;
    assert("exactly one AgentSession for chatId", sessions.length === 1);
    const session = sessions[0];
    assertEqual(
      "AgentSession.partnerModel",
      session.partnerModel,
      PARTNER_MODEL
    );

    const submissions = await sql<
      Array<{ qualtricsResponseId: string | null; status: string }>
    >`
      SELECT "qualtricsResponseId", status
      FROM "SurveySubmission" WHERE "chatId" = ${chatId}`;
    assert("exactly one SurveySubmission for chatId", submissions.length === 1);
    const submission = submissions[0];
    assertEqual("SurveySubmission.status", submission.status, "submitted");

    const messages = await sql<
      Array<{ role: string; partnerModel: string | null }>
    >`
      SELECT role, "partnerModel" FROM "Message_v2" WHERE "chatId" = ${chatId}`;
    assert("Message_v2 rows exist for chatId", messages.length > 0);
    const userRows = messages.filter((m) => m.role === "user");
    assert("at least one user-role Message_v2 row", userRows.length > 0);
    assert(
      "a user-role row carries the expected partnerModel",
      userRows.some((m) => m.partnerModel === PARTNER_MODEL)
    );
    // No mid-session partnerModel swap among rows that declare one.
    const distinctModels = new Set(
      messages.map((m) => m.partnerModel).filter((m): m is string => m != null)
    );
    assert(
      "no mid-session partnerModel swap",
      distinctModels.size === 1 && distinctModels.has(PARTNER_MODEL)
    );
    console.log("  ✓ AgentSession / SurveySubmission / Message_v2 reads pass");

    // ── Qualtrics side ───────────────────────────────────────────
    console.log("\n→ Qualtrics-side read (getResponse):");
    const response = await qualtricsGetResponse(qualtricsResponseId);
    const qChatId = response.values.chat_id;
    const qCompletionCode = response.values.completion_code;
    const qSeq = response.values.participant_seq;
    console.log(
      `  chat_id=${String(qChatId)} completion_code=${String(
        qCompletionCode
      )} participant_seq=${String(qSeq)}`
    );

    // ── Hard equality assertions (forward) ───────────────────────
    assertEqual(
      "qualtrics.chat_id === AgentSession.chatId",
      qChatId,
      session.chatId
    );
    assertEqual(
      "qualtrics.completion_code === AgentSession.completionCode",
      qCompletionCode,
      session.completionCode
    );
    assertEqual(
      "String(qualtrics.participant_seq) === String(AgentSession.seq)",
      String(qSeq),
      String(session.seq)
    );
    assertEqual(
      "SurveySubmission.qualtricsResponseId === returnedResponseId",
      submission.qualtricsResponseId,
      qualtricsResponseId
    );
    // Sanity: the join keys the API reported also agree.
    assertEqual(
      "driven.completionCode matches DB",
      completionCode,
      session.completionCode
    );
    console.log("  ✓ forward equality assertions pass");

    // ── Reverse-direction proof ──────────────────────────────────
    // Re-query Supabase using ONLY the Qualtrics-supplied keys.
    console.log("\n→ Reverse lookup from Qualtrics-supplied keys:");
    if (typeof qChatId !== "string") {
      throw new Error("qualtrics chat_id is not a string");
    }
    const byChatId = await sql<Array<{ chatId: string }>>`
      SELECT "chatId" FROM "AgentSession" WHERE "chatId" = ${qChatId}`;
    assert(
      "reverse: exactly one AgentSession by Qualtrics chat_id",
      byChatId.length === 1
    );
    assertEqual(
      "reverse: chat_id resolves to original",
      byChatId[0].chatId,
      chatId
    );

    if (typeof qCompletionCode !== "string") {
      throw new Error("qualtrics completion_code is not a string");
    }
    const byCode = await sql<Array<{ chatId: string }>>`
      SELECT "chatId" FROM "AgentSession" WHERE "completionCode" = ${qCompletionCode}`;
    assert(
      "reverse: exactly one AgentSession by Qualtrics completion_code (unique index)",
      byCode.length === 1
    );
    assertEqual(
      "reverse: completion_code resolves to original",
      byCode[0].chatId,
      chatId
    );
    console.log("  ✓ reverse-direction proof passes");

    console.log("\n──────────────────────────────────────────────────────");
    console.log("  LINKAGE VERIFIED — one identity across both systems.");
    console.log(`  participantExternalId=${participantExternalId}`);
    console.log("──────────────────────────────────────────────────────");
  } finally {
    try {
      if (partnerName) {
        await cleanup(sql, partnerName, qualtricsResponseId);
      }
    } finally {
      await sql.end();
    }
  }

  console.log("\n================ ✅ trace test passed ================");
}

main().catch((e) => {
  console.error("\n❌ trace test failed:", e);
  process.exit(1);
});
