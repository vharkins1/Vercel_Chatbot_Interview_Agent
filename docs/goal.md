# Repo goal

A research-study chatbot that conducts personal interviews for a communications study with many independent participants. Each `Chat` row is one interview session — one trial — and the data model preserves both **who the participant is** (longitudinal across sessions) and **which agent platform** delivered them.

## What this repo does

Runs an interview agent built on the Vercel AI Chat SDK template. The interviewer is an OpenAI Responses-API call against a stored prompt (`OPENAI_POSITIVE_PROMPT_ID` / `OPENAI_POSITIVE_PROMPT_VERSION`), which opens with: *"Hello, and welcome to this interview session. You will be asked personal questions across a variety of topics."* The session continues turn-by-turn until the caller marks it complete.

Two entry points run the same interview flow against the same DB:

1. **Browser chat UI** (`app/(chat)/...`) — for humans. NextAuth handles login or guest auth; chats appear in a sidebar. Used during development and for human pilot runs.
2. **Agent API** (`app/api/agent/v1/sessions/...`) — for AI agents on the other end of the interview. Each agent self-issues a bearer key via `POST /api/agent/v1/keys`, hits `POST /sessions` to start a chat (passing a stable participant identifier), posts to `/turns` to send a message, and `/complete` to close it out. Conversation continuity is held server-side via the OpenAI `previous_response_id`; the caller never has to replay history.

The two paths divide sessions cleanly by **interaction type**: a session with `Chat.partnerAgentId IS NOT NULL` is an Agent session; `IS NULL` is a Human session. No string-matching on partner names is required to tell them apart.

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
