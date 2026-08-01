/**
 * Verify that a participant reaching the end of an interview actually lands on
 * the Qualtrics follow-up survey with the study join keys attached.
 *
 *   pnpm verify:handoff          # config preflight: read-only, no writes anywhere
 *   pnpm verify:handoff --live   # also run a real interview against a running app
 *
 * Every failure mode this catches is otherwise silent: an unset follow-up URL
 * produces no link at all, and embedded-data fields that aren't declared in the
 * survey flow are dropped by Qualtrics without any error, yielding human
 * responses that cannot be joined back to a transcript.
 *
 * --live mints an invitation, runs an interview to its close against a running
 * dev server (BASE_URL, default http://localhost:3000), asserts the closing
 * question fired and the link was appended and persisted, then deletes every
 * row it created. Cleanup runs even on failure; the chat id is printed so a
 * crashed run can be cleaned up by hand.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { invitation } from "../lib/db/schema";
import { labelForCondition } from "../lib/study/conditions";
import {
  CLOSING_QUESTION_TEXT,
  looksLikeEnd,
  MAX_PARTICIPANT_TURNS,
  SURVEY_UNLOCK_AFTER_LLM_TURNS,
} from "../lib/study/interview-end";
import { generateJti, signInvitation } from "../lib/study/invitations";

config({ path: ".env.local" });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
// `rid` is the Qualtrics ResponseID of the PRE-interview survey, carried
// through the interview and back so pre ↔ transcript ↔ post all join on one
// key. Like the others it is silently dropped unless declared in the flow.
const REQUIRED_FIELDS = [
  "chat_id",
  "participant_seq",
  "completion_code",
  "rid",
];

let failures = 0;

const pass = (label: string, detail = "") => {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
};

const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  FAIL  ${label} — ${detail}`);
};

const check = (label: string, ok: boolean, detail: string) => {
  if (ok) {
    pass(label, detail);
  } else {
    fail(label, detail);
  }
};

type FlowElement = {
  Type: string;
  FlowID?: string;
  EmbeddedData?: Array<{ Field?: string }>;
};

const qualtricsGet = async <T>(path: string): Promise<T> => {
  const dc = process.env.QUALTRICS_DATACENTER;
  const token = process.env.QUALTRICS_API_TOKEN;
  if (!(dc && token)) {
    throw new Error("QUALTRICS_DATACENTER and QUALTRICS_API_TOKEN required");
  }
  const res = await fetch(`https://${dc}.qualtrics.com${path}`, {
    headers: { "X-API-TOKEN": token },
  });
  if (!res.ok) {
    throw new Error(`Qualtrics ${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
};

/** The closing question is both the participant's instruction and the end
 *  signal. If someone edits one without the other, interviews silently stop
 *  ending and every participant runs to the turn cap. */
const checkEndDetection = () => {
  console.log("\nEnd-of-interview detection");
  check(
    "closing question is recognized as an ending",
    looksLikeEnd(CLOSING_QUESTION_TEXT),
    `matcher vs "${CLOSING_QUESTION_TEXT}"`
  );
  check(
    "survives bold markdown and trailing text",
    looksLikeEnd(`**${CLOSING_QUESTION_TEXT}** https://example.com`),
    "formatting-tolerant"
  );
  const falsePositives = [
    "Let's wrap up this topic and move on.",
    "That concludes this section of questions.",
    "Thanks for sharing that. What happened next?",
  ];
  const tripped = falsePositives.filter((t) => looksLikeEnd(t));
  check(
    "ordinary interviewer prose does not end the interview",
    tripped.length === 0,
    tripped.length === 0
      ? `${falsePositives.length} controls stayed open`
      : `tripped on: ${tripped.join(" | ")}`
  );
  check(
    "fallback unlocks before the hard cap",
    SURVEY_UNLOCK_AFTER_LLM_TURNS < MAX_PARTICIPANT_TURNS,
    `unlock at ${SURVEY_UNLOCK_AFTER_LLM_TURNS}, cap at ${MAX_PARTICIPANT_TURNS} LLM calls`
  );
};

const checkFollowupConfig = async (): Promise<string | null> => {
  console.log("\nFollow-up survey configuration");
  const base = process.env.QUALTRICS_FOLLOWUP_URL;
  if (!base) {
    fail(
      "QUALTRICS_FOLLOWUP_URL is set",
      "unset, so no link is produced at all and the survey handoff is dead"
    );
    return null;
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    fail("QUALTRICS_FOLLOWUP_URL is a valid absolute URL", base);
    return null;
  }
  pass("QUALTRICS_FOLLOWUP_URL is set", url.origin + url.pathname);

  const surveyId = url.pathname.match(/\/jfe\/form\/(SV_[A-Za-z0-9]+)/)?.[1];
  if (!surveyId) {
    fail(
      "URL points at a Qualtrics survey form",
      `no /jfe/form/SV_... in ${url.pathname}`
    );
    return null;
  }
  pass("URL points at a Qualtrics survey form", surveyId);

  // The link participants actually receive, with the join keys attached.
  const probe = new URL(url.toString());
  probe.searchParams.set("chat_id", "00000000-0000-0000-0000-000000000000");
  probe.searchParams.set("participant_seq", "0");
  probe.searchParams.set("completion_code", "verifyhandoff");
  try {
    const res = await fetch(probe.toString(), { redirect: "follow" });
    check(
      "survey URL is reachable with join keys attached",
      res.ok,
      `HTTP ${res.status}`
    );
  } catch (error) {
    fail("survey URL is reachable with join keys attached", String(error));
  }

  return surveyId;
};

const checkEmbeddedData = async (surveyId: string) => {
  console.log("\nQualtrics embedded data (survey flow)");
  let flow: FlowElement[];
  try {
    const body = await qualtricsGet<{ result: { Flow: FlowElement[] } }>(
      `/API/v3/survey-definitions/${surveyId}/flow`
    );
    flow = body.result.Flow ?? [];
  } catch (error) {
    fail("survey flow is readable", String(error));
    return;
  }

  const embedded = flow.find((f) => f.Type === "EmbeddedData");
  if (!embedded) {
    fail(
      "survey flow declares an Embedded Data element",
      "none found. Qualtrics DROPS undeclared URL params, so chat_id, " +
        "participant_seq and completion_code would never reach the response. " +
        "Fix: Survey Flow > Add a New Element > Embedded Data, add the three " +
        "fields, and drag it above the first block."
    );
    return;
  }
  pass("survey flow declares an Embedded Data element", `${embedded.FlowID}`);

  const declared = new Set(
    (embedded.EmbeddedData ?? []).map((f) => f.Field).filter(Boolean)
  );
  for (const field of REQUIRED_FIELDS) {
    check(
      `embedded field "${field}" is declared`,
      declared.has(field),
      declared.has(field)
        ? "captured from the URL"
        : "would be silently dropped"
    );
  }

  // Fields declared after the questions cannot capture the inbound URL params.
  const embeddedIdx = flow.indexOf(embedded);
  const firstBlockIdx = flow.findIndex((f) => f.Type === "Block");
  check(
    "Embedded Data element precedes the first question block",
    firstBlockIdx === -1 || embeddedIdx < firstBlockIdx,
    firstBlockIdx === -1 || embeddedIdx < firstBlockIdx
      ? `position ${embeddedIdx} of ${flow.length}`
      : `at position ${embeddedIdx}, but the first block is at ${firstBlockIdx}; move it to the top of the flow`
  );
};

const PARTICIPANT_REPLIES = [
  "I mostly use it to keep up with a few niche communities I care about.",
  "Twice a day, usually in the evening when things are quiet.",
  "The recommendations feel repetitive, the same handful of accounts.",
  "I trust it more than most, but I still double check anything odd.",
  "I stopped posting much after a thread of mine drew strange replies.",
  "It would help to see why something was put in front of me.",
  "My close friends aren't on it, so it's more a reading habit.",
  "Somewhat satisfied, but not enough to recommend it unprompted.",
  "Search is weak, I usually give up and look elsewhere.",
  "I have never paid for anything on it and probably would not.",
  "Notifications overwhelmed me until I turned most of them off.",
  "The tone shifted over the last year, less friendly than before.",
  "Useful for following events as they happen, less so afterward.",
  "I would miss the smaller groups more than the main feed.",
  "No strong feelings about the interface, it stays out of the way.",
  "I'd want clearer controls over what shows up, that's the main thing.",
  "Maybe once a week I see something genuinely worth saving.",
  "I have not run into much of that personally.",
  "That covers most of what I think about it.",
  "Nothing else comes to mind right now.",
  "No, I think we covered everything.",
  "Agreed, that is a fair summary.",
  "Thanks, that is all from me.",
  "Understood.",
  "Understood.",
];

type TurnResponse = {
  assistantMessage: { id: string; text: string };
  ended?: boolean;
  surveyUnlocked?: boolean;
  followupUrl?: string | null;
};

const runLiveHandoff = async (sql: postgres.Sql) => {
  console.log("\nLive interview handoff");
  const db = drizzle(sql);

  if (!process.env.INVITE_JWT_SECRET) {
    fail("INVITE_JWT_SECRET is set", "cannot mint a test invitation");
    return;
  }

  const jti = generateJti();
  const ttlSeconds = 3600;
  const token = await signInvitation({ jti, condition: "A", ttlSeconds });
  await db.insert(invitation).values({
    jti,
    condition: "A",
    conditionLabel: labelForCondition("A"),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    batchLabel: "verify-handoff",
  });

  let chatId: string | null = null;
  try {
    const created = await fetch(`${BASE_URL}/api/participant/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationToken: token }),
    });
    if (!created.ok) {
      fail(
        "participant session starts",
        `HTTP ${created.status} from ${BASE_URL} (is the dev server running?)`
      );
      return;
    }
    const cookie = (created.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    const session = (await created.json()) as { chatId: string };
    chatId = session.chatId;
    pass("participant session starts", chatId);

    const send = async (text: string): Promise<TurnResponse> => {
      const res = await fetch(
        `${BASE_URL}/api/participant/v1/sessions/${chatId}/turns`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ text }),
        }
      );
      if (!res.ok) {
        throw new Error(`turn failed: HTTP ${res.status}`);
      }
      return (await res.json()) as TurnResponse;
    };

    let body = await send(
      "Please start the interview by greeting the candidate and asking the first question."
    );
    let llmCalls = 1;
    while (!body.ended && llmCalls < MAX_PARTICIPANT_TURNS) {
      const reply =
        PARTICIPANT_REPLIES[
          Math.min(llmCalls - 1, PARTICIPANT_REPLIES.length - 1)
        ];
      body = await send(reply);
      llmCalls++;
    }

    check(
      "interview reaches an ending",
      Boolean(body.ended),
      `${llmCalls} LLM calls (cap ${MAX_PARTICIPANT_TURNS})`
    );
    const finalText = body.assistantMessage.text;
    check(
      "final message asks the closing question",
      looksLikeEnd(finalText),
      looksLikeEnd(finalText) ? "matched" : `got: ${finalText.slice(0, 120)}`
    );

    const url = body.followupUrl ?? null;
    check(
      "turn response carries the follow-up link",
      Boolean(url),
      url ? "present" : "null (QUALTRICS_FOLLOWUP_URL unset?)"
    );
    if (url) {
      for (const field of REQUIRED_FIELDS) {
        check(
          `link carries ${field}`,
          new URL(url).searchParams.has(field),
          new URL(url).searchParams.get(field) ?? "missing"
        );
      }
      check(
        "link is appended to the message the participant sees",
        finalText.includes(url),
        finalText.includes(url) ? "appended" : "closing question has no link"
      );
    }

    // The transcript export must match what was on screen.
    const [stored] = await sql`
      SELECT parts->0->>'text' AS text FROM "Message_v2"
      WHERE "chatId" = ${chatId} AND role = 'assistant'
      ORDER BY "createdAt" DESC LIMIT 1`;
    check(
      "appended link is persisted to the transcript",
      Boolean(url) && String(stored?.text ?? "").includes(url ?? " "),
      "Message_v2 final assistant row"
    );

    // /complete must not mint a different code than the turn route did.
    const completed = await fetch(
      `${BASE_URL}/api/participant/v1/sessions/${chatId}/complete`,
      { method: "POST", headers: { cookie } }
    );
    const completeBody = (await completed.json()) as {
      followupUrl: string | null;
    };
    check(
      "/complete returns an identical link",
      completeBody.followupUrl === url,
      completeBody.followupUrl === url ? "identical" : "DRIFT between routes"
    );
  } catch (error) {
    fail("live handoff", String(error));
  } finally {
    if (chatId) {
      const [row] = await sql`
        SELECT "participantId" FROM "Chat" WHERE id = ${chatId}`;
      await sql`DELETE FROM "SurveyAnswer" WHERE "chatId" = ${chatId}`;
      await sql`DELETE FROM "SurveySubmission" WHERE "chatId" = ${chatId}`;
      await sql`DELETE FROM "ChatQuestion" WHERE "chatId" = ${chatId}`;
      await sql`DELETE FROM "Message_v2" WHERE "chatId" = ${chatId}`;
      await sql`DELETE FROM "AgentSession" WHERE "chatId" = ${chatId}`;
      await sql`DELETE FROM "Chat" WHERE id = ${chatId}`;
      if (row?.participantId) {
        const [p] = await sql`
          SELECT "userId" FROM "Participant" WHERE id = ${row.participantId}`;
        await sql`DELETE FROM "Participant" WHERE id = ${row.participantId}`;
        if (p?.userId) {
          await sql`DELETE FROM "User" WHERE id = ${p.userId}`;
        }
      }
    }
    await sql`DELETE FROM "Invitation" WHERE "batchLabel" = 'verify-handoff'`;
    const [left] = await sql`
      SELECT COUNT(*)::int AS n FROM "Chat" WHERE id = ${chatId ?? null}`;
    check(
      "test data cleaned up",
      (left?.n ?? 0) === 0,
      (left?.n ?? 0) === 0
        ? "no rows left behind"
        : `chat ${chatId} still present, delete it by hand`
    );
  }
};

const main = async () => {
  const live = process.argv.includes("--live");
  console.log(
    `Survey handoff verification${live ? " (config + live interview)" : " (config only)"}`
  );

  checkEndDetection();
  const surveyId = await checkFollowupConfig();
  if (surveyId) {
    await checkEmbeddedData(surveyId);
  }

  if (live) {
    const url = process.env.POSTGRES_URL;
    if (url) {
      const sql = postgres(url, { max: 1 });
      try {
        await runLiveHandoff(sql);
      } finally {
        await sql.end();
      }
    } else {
      fail("POSTGRES_URL is set", "required for --live");
    }
  } else {
    console.log("\n  (skipping live interview; re-run with --live)");
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) failed. The survey handoff is not safe to launch.`
  );
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
