# Repo goal

A research-study chatbot that conducts personal interviews for a communications study with many independent participants. Each `Chat` row is one interview session (one trial) and the data model preserves both **who the participant is** (longitudinal across sessions) and **which agent platform** delivered them.

## What this repo does

Runs an interview chatbot built on the Vercel AI Chat SDK template. The interviewer is an OpenAI Responses-API call against a stored prompt, which opens by greeting the interviewee and asking the first question. The session continues turn-by-turn until the caller marks it complete.

The study uses **three interviewer conditions, blinded as `A` / `B` / `C`**. The real labels (positive / neutral / disconfirmatory) live only in `lib/study/conditions.ts:CONDITION_LABEL`, in `AgentSession.conditionLabel` (DB, staff-only), and in `docs/conditions-mapping.md` (gitignored). All env vars, API responses, and UI strings use the blinded letters so partners and analysts can't infer arm from the data they see. Each condition is backed by its own stored prompt, pointed at by `OPENAI_A_PROMPT_ID` / `OPENAI_B_PROMPT_ID` / `OPENAI_C_PROMPT_ID` (+ optional `_VERSION` per arm).

Three entry points run the same interview flow against the same DB:

1. **Agent API** (`app/api/agent/v1/...`): back-end-to-back-end, for partner AI agents. Each agent self-issues a bearer key via `POST /keys`, hits `POST /sessions` to start a chat (passing a stable participant identifier and its own model id in `partnerModel`, **required**), posts to `/turns` to send a message, and `/complete` to close out. Continuity is held server-side via OpenAI's `previous_response_id`; the caller never replays history. If no `invitationToken` is supplied, the server randomly assigns A/B/C; if a token is supplied, the token's pinned condition is used. The agent sees the assigned A/B/C in the response but never the descriptive label.
2. **Participant API** (`app/api/participant/v1/...`): browser-side, for humans. Authenticated by an invitation JWT on session creation, then a short-lived `participant_session` cookie for `/turns` and `/complete`. Sessions have `Chat.partnerAgentId = NULL` and `Message_v2.partnerModel = NULL` throughout.
3. **Participant chat UI** (`app/chat/page.tsx`): the human-facing page, entered via `/chat?t=<invitation-jwt>` from a recruitment link. Renders against the participant API. On the first mount it fires a hidden seed turn so the interviewer opens the conversation, and on completion redirects to `QUALTRICS_FOLLOWUP_URL` if set.

Sessions divide cleanly by interaction type: `Chat.partnerAgentId IS NOT NULL` ⇒ agent session, `IS NULL` ⇒ human session. No name-matching needed.

## Studies

The repo serves two studies that share the interview engine but diverge at the post-interview handoff:

- **Study 1: Agents as subjects (current focus).** AI agents are the participants. Each agent runs the full interview via the Agent API, then submits a post-interview survey response programmatically to **Qualtrics via the Response Import API** (`POST /API/v3/surveys/{surveyId}/responses` with an `X-API-TOKEN` header). The agent never touches a browser. Agent-submitted responses are flagged in Qualtrics so they can be filtered out of human datasets. The Qualtrics piece is not yet implemented.
- **Study 2: Humans as subjects.** Real participants reach the app via a one-shot tokenized recruitment link (`/chat?t=<invitation-jwt>`), do the interview in the participant chat UI, and on completion are redirected to `QUALTRICS_FOLLOWUP_URL`. Condition is **pinned per token at mint time** (via `pnpm db:create-invitations --condition A|B|C`); there is no client-side randomization, so the operator controls arm allocation by how tokens are distributed. The link landing page, JWT redemption, participant cookie session, hidden seed turn, and completion redirect are all wired up. The Qualtrics survey itself uses embedded data and a `completion_code` join key (still deferred; see below).

The two studies may be merged into a single combined run later; for now they're tracked independently and the codepaths diverge only at the completion step.

### Deferred work

Tracked here so the next-up work is visible without leaving the goal doc.

- **Qualtrics Response Import API integration (Study 1).** Submit a post-survey response programmatically when an agent completes the interview. Endpoint: `POST https://{datacenter}.qualtrics.com/API/v3/surveys/{surveyId}/responses` with header `X-API-TOKEN`. New env vars: `QUALTRICS_API_TOKEN`, `QUALTRICS_DATACENTER`, `QUALTRICS_SURVEY_ID_STUDY1`. Need to map our interview schema to the survey's question IDs (`QID3`, `QID7`, …) and add a flag distinguishing agent-submitted responses from human ones in exports.
- **Browser embedded-data handoff (Study 2).** Today `/complete` redirects to a static `QUALTRICS_FOLLOWUP_URL`. To match Qualtrics responses back to interview rows we need to append embedded data (`pid`, `condition`, `completion_code`) as query params, and declare those three as Embedded Data at the top of the Qualtrics survey flow.
- **`completion_code` on `AgentSession`.** Random 16-char base64url, set at `/complete`. Acts as the join key between transcripts and Qualtrics responses when matching exports.

### Pre-launch audit checklist

Things to confirm before going to real participants. None of these block the agent-only smoke flow that's running today, but each is a sharp edge if launched as-is.

- **Auth/key flow audit.** `/api/agent/v1/keys` is unauthenticated (only IP-rate-limited) and returns a multi-use key. Decide before launch: gate the endpoint behind an operator bootstrap secret or IP allowlist, shorten key TTL, or bind keys to a single session (auto-revoke on `/complete`). Revisit the per-partner session rate limit (currently 50/hour) against expected traffic. Define an `INVITE_JWT_SECRET` rotation policy.
- **Materialize `SessionTranscript`.** The view DDL is in `scripts/create-session-transcript-view.ts` but was never run against prod; only `SessionOverview` exists. Run `pnpm db:create-session-transcript-view`, and update both view scripts to read `condition` from `AgentSession.condition` (post-milestone-3) instead of `Participant.metadata`.
- **Message classification.** Assistant turns (acknowledgments / questions / feedback summaries) are stored as undifferentiated text in `Message_v2`. Researchers can read full transcripts but cannot SQL-slice "all feedback turns" or compare feedback across conditions. Either add explicit markers in the prompt template + a `Message_v2.kind` column, or ship a heuristic post-hoc view and accept its imprecision.
- **Model self-disclosure: resolved by required `partnerModel`.** `POST /api/agent/v1/sessions` now requires `partnerModel` in the request body, and `Message_v2.partnerModel` is stamped on every user-turn row so per-turn history is preserved (mid-session model swaps are queryable). No in-conversation model question is asked, so the negative-condition prompt's non-disclosure guardrail is no longer a blocker. `AgentSession.partnerModel` still holds the "latest known" value for fast filters.
- **Distribution sanity check (agent path).** When an agent calls `POST /sessions` without an `invitationToken`, the server randomly assigns A/B/C via `Math.random()`. Run ~30 sessions in dev and confirm condition counts land within tolerance of uniform. If skewed, swap to a deterministic round-robin across `ALL_CONDITIONS`. (Participant path is unaffected; condition is pinned per token at mint time, not randomized at click time.)
- **Unset `PARTICIPANT_INVITATIONS_REUSABLE`.** This env flag (added during pre-launch testing) makes invitation tokens reusable: the participant API skips the single-use binding and lets the same `/chat?t=<token>` URL start a fresh session on every click. JWT signature, expiry, and DB-row existence checks still run. Intended only so the research team can share one link while testing. Must be unset (or `!= "1"`) in the prod env before real participants, otherwise distinct human respondents collapse onto a single `jti` for funnel analysis. If you used it during testing, also clean up the dev rows: `DELETE FROM "Invitation" WHERE "batchLabel" = 'team-testing'` (or whatever batch label you minted).
- **Unset `UNBLIND_FRONTEND`.** This env flag (added during pre-launch testing) makes the participant session-creation endpoint return the blinded condition code + descriptive label to the browser, which the participant UI renders as a staff/debug badge. Must be unset (or `!= "1"`) in the prod env before real participants; otherwise the study arm is visible to respondents and the blinding is broken.
- **Drop the full transcript from `/api/agent/v1/sessions/{chatId}/complete` response.** Today the complete endpoint returns the entire `messages[]` array (see `app/api/agent/v1/sessions/[chatId]/complete/route.ts` and `completeInterviewSession` in `lib/study/session-service.ts`). Agents already have every assistant turn from `/turns` and can refetch via `GET /sessions/{chatId}` if needed; echoing the transcript on completion is wasted payload and a needless re-exposure of historical content. Trim the response to `{ chatId, agentSession, completionCode }` (the `completionCode` lands here when the Qualtrics handoff is added). Same trim should be considered for the participant API's `/complete` for symmetry.
- **Qualtrics embedded-data fields for participant tracking (automated).** As of migration `0019`, each `AgentSession` gets a monotonic `seq` (participant number 1, 2, 3, …) assigned on creation. On survey submission the agent path pushes two extra embedded-data fields alongside `completion_code`: `participant_seq` and `chat_id` (see `app/api/agent/v1/sessions/[chatId]/survey/route.ts`). The human path appends the same two as `?participant_seq=&chat_id=` query params on the `QUALTRICS_FOLLOWUP_URL` redirect. **Qualtrics silently drops embedded data that isn't declared in the Survey Flow.** Declaring them is automated: run `pnpm db:ensure-survey-fields` (`scripts/ensure-survey-fields.ts`); it idempotently adds `participant_seq` + `chat_id` to the existing EmbeddedData flow element (cloning the `completion_code` entry's shape) without touching any blocks. Already run against the Study-1 survey on 2026-05-29 and verified: a fresh submission now persists `participant_seq` + `chat_id` on the response row. Re-run only if the survey is rebuilt. (The human follow-up survey, if it's a separate Qualtrics survey, still needs its own embedded-data declaration to capture the query params.) Backend counting works regardless via `pnpm db:count-participants` (reads `AgentSession.seq` directly). Note: the symptom that prompted this ("respondents all answering with their name repeatedly") was **not** a survey-serving bug (all 16 pages parse and serve correctly); it was QID1 ("Input your Moltbook name") being filled with the model id, which is identical across agents of the same model, leaving no per-respondent identifier. `participant_seq` + `chat_id` are that identifier.
- **`e2e-survey-test.ts` DB cleanup was silently no-op'ing.** The script issued its partner key with `{ name }`, but `/api/agent/v1/keys` only honors `{ label }` and always names the partner `<label>-<hash>`; cleanup then looked the partner up by the ignored `name` string, matched zero rows, and deleted nothing (it still deleted the Qualtrics response, so the leak was DB-only). Fixed to issue with `label` and clean up by the returned `partnerName`. Historical impact: prior smoke runs left their `Chat`/`AgentSession`/`Message_v2`/`Survey*` rows in the DB; these are part of why the table has accumulated test sessions. Filter test partners before analysis as usual.
- **Interviewer loop on inflexible interviewee replies.** In a 10-session batch (2026-05-29), 5 interviews ended naturally (alpha, beta, epsilon, eta, kappa) and 5 hit the 25-turn max because the interviewer kept re-asking the same question (gamma, delta, zeta, theta, iota). Root cause was on the **interviewee** side (scripted/canned replies were too narrow to satisfy all of the interviewer's prompt branches), not an API failure. The survey portion was unaffected: all 10 Qualtrics submissions succeeded, each returning a `qualtricsResponseId` after walking all 16 pages. Before launch decide: (a) tighten the interviewer Stored Prompt to detect "already-answered" and move on after N restatements, (b) lower the 25-turn cap so doomed loops fail fast, or (c) accept it for human participants (humans rarely give the *same* canned reply twice). For agent partners, the right fix is partner-side: agents should generate dynamic responses rather than replay a fixed script. Note in `agent-docs.md` if we want to push that responsibility outward.

## Study model

The study has two tracking axes that must both be queryable independently:

- **Per-participant (subject) tracking.** Every interviewee is a `Participant`, identified by the partner-supplied `externalId` (stable across sessions). Multiple interviews from the same participant link back to the same row. Each `Participant` is backed by a synthetic `User` so the existing chat plumbing (ownership, FK constraints) keeps working. Anything the partner wants to attach (demographics, consent flags, recruitment source) lands in `Participant.metadata` (JSON).
- **Per-agent (platform) tracking.** Every Agent-API session is stamped with the `PartnerAgent` row that minted its key. Self-issued keys produce one `PartnerAgent` row per key (named `<label>-<random>`), so per-agent and per-platform analyses are both single `WHERE` filters. Browser sessions have no `PartnerAgent` and are identified by `partnerAgentId IS NULL`.

Each `Chat` carries both `partnerAgentId` and `participantId`; the same is mirrored on `AgentSession` for join convenience. Uniqueness on `Participant` is `(partnerAgentId, externalId)`.

## What we capture for the study

The full field-level breakdown is in [`docs/study-data-model.md`](./study-data-model.md). In summary:

- **Participant**: `externalId`, partner attribution, synthetic user FK, `metadata`, enrollment timestamp.
- **Chat / AgentSession**: pinned `promptId` + `promptVersion` per session; pinned blinded `condition` (`A`/`B`/`C`) and staff-only `conditionLabel`; `responseId` chain; `interviewerModel` (auto-captured from OpenAI response metadata, e.g. `gpt-4o-mini-2024-07-18`); `partnerModel` ("latest known" interviewee model, required on agent session creation, NULL on human sessions); start / complete timestamps; optional running `totalTokens`.
- **Messages** (`Message_v2`): full transcript with `role`, `parts`, `attachments`, `createdAt`, and `partnerModel` stamped on every user-turn row (per-turn audit of the declared interviewee model; `SELECT chatId FROM "Message_v2" GROUP BY chatId HAVING COUNT(DISTINCT "partnerModel") > 1` surfaces mid-session model swaps). This is the primary study artifact.

Deliberately not stored: per-turn telemetry, per-message token usage, latency. The transcript plus a session-level token total is enough.

## What's intentionally NOT in scope

- Researcher / admin UI for browsing sessions. Researchers query the DB directly (drizzle studio, psql, scheduled exports).
- Public chat sharing or read-only links.
- Per-agent rate limiting beyond what the platform provides; audit logs beyond `lastUsedAt`; secret-vault integration for keys.

## Operationally

- DB: Supabase Postgres. Migrations via Drizzle (`pnpm db:generate` / `pnpm db:migrate`). **Commit migrations before they run.** `pnpm db:migrate` (and `pnpm build`'s pre-step) records the SQL hash in `__drizzle_migrations` and skips that tag on every future build; so an uncommitted migration run locally against prod is silently un-replayable, and any code refactor that depends on it can drift out of sync with the schema. If you find yourself doing `pnpm db:generate` followed by anything other than `git add lib/db/migrations/`, stop.
- Useful diagnostic queries:
  ```sql
  -- Same IP across multiple sessions (multi-account or shared link)
  -- We store a keyed one-way hash of the IP, never the raw IP; the hash is
  -- deterministic so identical IPs still collide here.
  SELECT "startIpHash", COUNT(*) FROM "Chat"
  WHERE "startIpHash" IS NOT NULL
  GROUP BY "startIpHash" HAVING COUNT(*) > 1;

  -- Mid-session IP changes (VPN flip, network handoff)
  SELECT "chatId", COUNT(DISTINCT "ipHash") FROM "Message_v2"
  WHERE "ipHash" IS NOT NULL
  GROUP BY "chatId" HAVING COUNT(DISTINCT "ipHash") > 1;

  -- Mid-session model swaps
  SELECT "chatId" FROM "Message_v2"
  GROUP BY "chatId" HAVING COUNT(DISTINCT "partnerModel") > 1;
  ```
- Hosted on Vercel. Deployment Protection is off for production so partner agents can hit the API without bypass tokens; previews stay SSO-locked.
- Auth: agent API uses sha256(key + `APP_PEPPER`) → DB lookup against `PartnerAgent.keyHash`. Mint partner keys with `pnpm db:create-partner <name>`; raw key is printed once.
- Prompt: the interviewer behavior lives in OpenAI's Stored Prompts feature, not in this repo. Update the prompt there; this code references it by `id` + `version`, and the version in effect is recorded on the session for reproducibility.
