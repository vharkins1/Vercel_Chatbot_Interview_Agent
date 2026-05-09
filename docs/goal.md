# Repo goal

A research-study chatbot that conducts personal interviews for a communications study with many independent participants. Each `Chat` row is one interview session — one trial — and the data model preserves both **who the participant is** (longitudinal across sessions) and **which agent platform** delivered them.

## What this repo does

Runs an interview agent built on the Vercel AI Chat SDK template. The interviewer is an OpenAI Responses-API call against a stored prompt, which opens with: *"Hello, and welcome to this interview session. You will be asked personal questions across a variety of topics."* The session continues turn-by-turn until the caller marks it complete.

The study uses **three interviewer conditions** (positive / neutral / negative), each backed by its own stored prompt. Today only the positive condition is wired up (`OPENAI_POSITIVE_PROMPT_ID` / `..._VERSION`); neutral and negative prompt IDs will be added alongside server-side condition assignment when the multi-condition study launches.

Two entry points run the same interview flow against the same DB:

1. **Browser chat UI** (`app/(chat)/...`) — for humans. NextAuth handles login or guest auth; chats appear in a sidebar. Used during development and for human pilot runs.
2. **Agent API** (`app/api/agent/v1/sessions/...`) — for AI agents on the other end of the interview. Each agent self-issues a bearer key via `POST /api/agent/v1/keys`, hits `POST /sessions` to start a chat (passing a stable participant identifier), posts to `/turns` to send a message, and `/complete` to close it out. Conversation continuity is held server-side via the OpenAI `previous_response_id`; the caller never has to replay history.

The two paths divide sessions cleanly by **interaction type**: a session with `Chat.partnerAgentId IS NOT NULL` is an Agent session; `IS NULL` is a Human session. No string-matching on partner names is required to tell them apart.

## Studies

The repo serves two studies that share the interview engine but diverge at the post-interview handoff:

- **Study 1 — Agents as subjects (current focus).** AI agents are the participants. Each agent runs the full interview via the Agent API, then submits a post-interview survey response programmatically to **Qualtrics via the Response Import API** (`POST /API/v3/surveys/{surveyId}/responses` with an `X-API-TOKEN` header). The agent never touches a browser. Agent-submitted responses are flagged in Qualtrics so they can be filtered out of human datasets. The Qualtrics piece is not yet implemented — it's the next milestone after multi-condition prompts land.
- **Study 2 — Humans as subjects (later).** Real participants reach the app via a recruitment link, do the interview in the browser UI, and on completion are redirected to a Qualtrics survey URL with embedded-data query params (`pid`, `condition`, `completion_code`). No Qualtrics API call — Qualtrics's web form handles the response. Condition assignment happens server-side at entry, before the chat UI loads, so the participant is blinded.

The two studies may be merged into a single combined run later; for now they're tracked independently and the codepaths diverge only at the completion step.

### Deferred work (post multi-condition milestone)

Tracked here so the next-up work is visible without leaving the goal doc.

- **Qualtrics Response Import API integration (Study 1).** Submit a post-survey response programmatically when an agent completes the interview. Endpoint: `POST https://{datacenter}.qualtrics.com/API/v3/surveys/{surveyId}/responses` with header `X-API-TOKEN`. New env vars: `QUALTRICS_API_TOKEN`, `QUALTRICS_DATACENTER`, `QUALTRICS_SURVEY_ID_STUDY1`. Need to map our interview schema to the survey's question IDs (`QID3`, `QID7`, …) and add a flag distinguishing agent-submitted responses from human ones in exports.
- **Browser redirect handoff (Study 2).** On `/complete`, build a Qualtrics URL with embedded data (`pid`, `condition`, `completion_code`) and return it for the client to navigate to. Declare those three as Embedded Data at the top of the Qualtrics survey flow.
- **`completion_code` on `AgentSession`.** Random 16-char base64url, set at `/complete`. Acts as the join key between transcripts and Qualtrics responses when matching exports.
- **`/interview?invite=<jwt>` landing route (Study 2).** Reads the invitation token from query params, redeems it, creates `Chat` + `AgentSession` with the assigned condition, sets a session cookie, redirects to the chat UI. Schema and JWT primitives are already in place — only the route is missing.
- **Human chat route refactor.** `app/(chat)/api/chat/route.ts` does not currently create or read `AgentSession` rows. To unify the two paths on one schema, the human path needs to create an AgentSession at session start (mirroring the agent path) and read the pinned `promptId` from it on every turn.

## Study model

The study has two tracking axes that must both be queryable independently:

- **Per-participant (subject) tracking.** Every interviewee is a `Participant`, identified by the partner-supplied `externalId` (stable across sessions). Multiple interviews from the same participant link back to the same row. Each `Participant` is backed by a synthetic `User` so the existing chat plumbing (ownership, FK constraints) keeps working. Anything the partner wants to attach — demographics, consent flags, recruitment source — lands in `Participant.metadata` (JSON).
- **Per-agent (platform) tracking.** Every Agent-API session is stamped with the `PartnerAgent` row that minted its key. Self-issued keys produce one `PartnerAgent` row per key (named `<label>-<random>`), so per-agent and per-platform analyses are both single `WHERE` filters. Browser sessions have no `PartnerAgent` and are identified by `partnerAgentId IS NULL`.

Each `Chat` carries both `partnerAgentId` and `participantId`; the same is mirrored on `AgentSession` for join convenience. Uniqueness on `Participant` is `(partnerAgentId, externalId)`.

## What we capture for the study

The full field-level breakdown is in [`docs/study-data-model.md`](./study-data-model.md). In summary:

- **Participant**: `externalId`, partner attribution, synthetic user FK, `metadata`, enrollment timestamp.
- **Chat / AgentSession**: pinned `promptId` + `promptVersion` per session, `responseId` chain, start / complete timestamps, optional running `totalTokens` so we can budget without inspecting per-turn data.
- **Messages** (`Message_v2`): full transcript with `role`, `parts`, `attachments`, `createdAt` — already in place. This is the primary study artifact.

Deliberately not stored: per-turn telemetry, per-message token usage, latency. The transcript plus a session-level token total is enough.

## What's intentionally NOT in scope

- Researcher / admin UI for browsing sessions. Researchers query the DB directly (drizzle studio, psql, scheduled exports).
- Public chat sharing or read-only links.
- Per-agent rate limiting beyond what the platform provides; audit logs beyond `lastUsedAt`; secret-vault integration for keys.

## Operationally

- DB: Supabase Postgres. Migrations via Drizzle (`pnpm db:generate` / `pnpm db:migrate`).
- Hosted on Vercel. Deployment Protection is off for production so partner agents can hit the API without bypass tokens; previews stay SSO-locked.
- Auth: agent API uses sha256(key + `APP_PEPPER`) → DB lookup against `PartnerAgent.keyHash`. Mint partner keys with `pnpm db:create-partner <name>`; raw key is printed once.
- Prompt: the interviewer behavior lives in OpenAI's Stored Prompts feature, not in this repo. Update the prompt there; this code references it by `id` + `version`, and the version in effect is recorded on the session for reproducibility.
