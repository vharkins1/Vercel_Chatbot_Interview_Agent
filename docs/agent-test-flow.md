# Agent Test Flow

End-to-end smoke test for the interview chatbot, run as an autonomous agent against the public deployment. The goal is to verify that:

- Keys can be self-issued
- A session can be created and run to completion
- The new app-side question selection (5 topics × 3 questions per session) works
- The transcript can be retrieved
- Nothing personally identifying is exposed in the public agent surface

You should be able to complete the whole flow in under 5 minutes. Total expected output: a single `Authorization: Bearer …` token that you keep for the duration of the test, one `chatId`, ~16 turns of conversation, and a short written report.

---

## Environment

```text
BASE   = https://vercel-chatbot-interview-agent.vercel.app
SUBJECT = test-<short-random-id>     # any opaque string ≤ 200 chars
```

Pick `SUBJECT` once at the start. Reuse it in every call below so the participant rows group together.

All requests use `Content-Type: application/json`. Authenticated requests use `Authorization: Bearer $KEY`.

**Use `curl` via Bash for every request in this flow.** Do not use `WebFetch` — it cannot send JSON bodies and will silently downgrade to GET, which all of these endpoints reject (405).

---

## Step 1 — Self-issue a bearer key

```http
POST {{BASE}}/api/agent/v1/keys
Content-Type: application/json

{ "label": "test" }
```

**Expected response (201):**

```json
{ "apiKey": "<base64url-string>", "partnerName": "test-<16hex>" }
```

**Capture `apiKey` as `$KEY`. It is shown only once.** If you lose it, call this endpoint again to mint a new one — there is no recovery endpoint.

**Verifications:**

- Status is `201`.
- `partnerName` starts with `test-` (the label you sent).
- `apiKey` is a non-empty string.

**Negative checks (report findings, do not block on them):**

- Call again with `{ "label": "BAD LABEL!" }`. Expect `400` (label must match `[a-z0-9-]+`).
- Call with no body. Expect `201` and `partnerName` starting with `agent-` (default label).

---

## Step 2 — Create a session

The `invitationToken` field (`$INVITE`) is **optional**. If you don't pass one, the server randomly assigns a condition itself (uniform across positive/neutral/negative) — fine for the smoke test. Pass one only when the operator has minted a token via `pnpm db:create-invitations --count 1 --batch agent-test` and wants you to consume it (it will be single-use; reuse returns 409).

```http
POST {{BASE}}/api/agent/v1/sessions
Authorization: Bearer {{KEY}}
Content-Type: application/json

{
  "participantExternalId": "{{SUBJECT}}",
  "participantMetadata": { "test_run": true, "started_at": "<iso8601-utc>" },
  "title": "agent test flow",
  "partnerModel": "<your model id, e.g. claude-sonnet-4-5>"
  // optional: "invitationToken": "{{INVITE}}"
}
```

`partnerModel` is the model identifier *you* are running on (the interviewee side). The server cannot infer this and uses it for analysis, so always set it. If you genuinely don't know, send `"unknown"` rather than omitting the field.

**Expected response (200):**

```json
{ "chatId": "<uuid>", "condition": "positive|neutral|negative", "agentSession": { "...": "..." } }
```

**Capture `chatId` as `$CHAT_ID`.**

**Verifications:**

- Status is `200`.
- `chatId` looks like a UUID.
- `agentSession.partnerModel` matches what you sent.

---

## Step 3 — Run the interview to completion

The interview consists of **5 topics × 3 questions = 15 question turns**, plus the model's own greeting/feedback turns. Send each user message via:

```http
POST {{BASE}}/api/agent/v1/sessions/{{CHAT_ID}}/turns
Authorization: Bearer {{KEY}}
Content-Type: application/json

{ "text": "<your reply>" }
```

**Critical rules:**

- **Do not replay history.** Send only the next user message each turn. The server holds conversation continuity via OpenAI's `previous_response_id`.
- **Be a cooperative interviewee.** Answer plausibly and concisely (1–3 sentences) so the interview can move forward. The point of the test is to verify infrastructure, not to stress-test refusals.
- **Track the questions you receive.** Maintain a list in your scratchpad: for each model turn, record the topic (if mentioned) and the question text.

### Suggested message sequence

| # | Your message | What you should observe in the response |
|---|---|---|
| 1 | `Start the interview.` | Greeting; model introduces the format and asks the first question of topic 1. |
| 2..4 | Cooperative answers (1–3 sentences each). | After turn 4 (your 3rd answer in the topic), the model gives **feedback** for that topic and moves to topic 2. |
| 5..7 | Cooperative answers. | Feedback after turn 7; transition to topic 3. |
| 8..10 | Cooperative answers. | Feedback; transition to topic 4. |
| 11..13 | Cooperative answers. | Feedback; transition to topic 5. |
| 14..16 | Cooperative answers. | After turn 16, model gives final feedback and indicates the interview is complete. |

(Exact turn counts will vary depending on whether the model bundles "feedback + next topic intro + next question" into one assistant turn or splits them. The test is structural, not exact.)

### What to record per turn

For each assistant response, log:

1. The **topic** the model is currently on (e.g., `ATTITUDES`, `TASTES`, `WORK`, `PERSONALITY`, `BODY`).
2. The **question text** the model just asked.
3. Whether the response includes **feedback** about your prior set of 3.

### What to verify at the end of step 3

You should observe **all 5 topic names appear** in the conversation: `ATTITUDES`, `TASTES`, `WORK`, `PERSONALITY`, `BODY`. If any are missing, that's a finding to report.

You should observe **3 questions per topic** (15 total). If a topic gets more or fewer, report it.

Note: questions are randomly selected per session, so you cannot pre-predict which 3 of the bank you will receive in any given topic. You can only verify the structural rule.

---

## Step 4 — Complete the session

```http
POST {{BASE}}/api/agent/v1/sessions/{{CHAT_ID}}/complete
Authorization: Bearer {{KEY}}
```

**Expected response (200).** Body shape is not important; status is.

**Verifications:**

- Status is `200`.

---

## Step 5 — Fetch the transcript

```http
GET {{BASE}}/api/agent/v1/sessions/{{CHAT_ID}}
Authorization: Bearer {{KEY}}
```

**Expected response (200):** the saved transcript including all of your messages and the model's replies in order.

**Verifications:**

- Status is `200`.
- The user messages you sent in step 3 are all present and in order.
- The assistant messages match what you observed live.

---

## Step 6 — Auth boundary check

Repeat **step 5** with one of these wrong tokens, one at a time:

- No `Authorization` header at all.
- A made-up token like `Bearer not-a-real-key`.
- A different valid key (mint a second one via step 1 in a parallel sub-experiment, then try to read the original `chatId` with that second key).

**Expected for all three:** non-2xx (typically `401` or `403`). The body should not leak any participant data.

---

## Step 7 — Report back

Produce a short structured report. Suggested format:

```text
## Result: PASS | PARTIAL | FAIL

## Token / IDs
- partnerName: ...
- chatId: ...
- subject (participantExternalId): ...

## Structural verifications
- 5 topics observed in this session: yes / no  (list which)
- 3 questions per topic: yes / no  (list counts per topic)
- Feedback delivered after each set of 3: yes / no
- Final feedback after all 5 topics: yes / no

## Questions received (in order)
TOPIC <topic name>
1. <question text>
2. <question text>
3. <question text>

(repeat for all 5 topics)

## Auth boundary check
- No Authorization header → status: ___
- Made-up token         → status: ___
- Different valid key   → status: ___

## Anomalies / Notes
- (anything surprising: latency spikes, malformed responses, off-bank questions, etc.)

## Sample verbatim turn
- User said: "..."
- Model replied: "..."
```

Keep the report under ~600 words. The full transcript is available via step 5 if a reviewer wants the raw data.

---

## Things to NOT test (out of scope for this flow)

- Browser/Human chat path (`/api/chat`). That requires NextAuth login and isn't agent-accessible.
- Concurrent sessions, load testing, latency benchmarks.
- Trying to elicit prompt-injection or off-bank questions. The point is structural, not adversarial.
- Modifying the question bank or the prompt template. Those are operator-side.

---

## If something fails

Capture the failing request/response pair (URL, status, body) and include it in the anomalies section of your report. Do not retry the same call more than 2 times — repeated failures should be reported, not papered over.

If the very first call (step 1) returns `503 agent_api_disabled`, the deployment is missing the `APP_PEPPER` environment variable. Stop and report that — no further steps will work.

If step 2 returns `401`, the key from step 1 wasn't accepted. Re-mint and retry once; if it still fails, report.

If step 3 turns return `no_agent_session`, the `chatId` in your URL doesn't match the session you created. Re-check capture from step 2.
