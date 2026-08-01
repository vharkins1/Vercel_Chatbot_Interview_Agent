# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A research-study interview chatbot, forked from the Vercel AI Chat SDK template but repurposed. The interviewer is an OpenAI Responses-API call against a Stored Prompt (id + version pinned per session). Each `Chat` row is one interview trial. Read `docs/goal.md` and `docs/study-data-model.md` before non-trivial changes; the study design constrains schema and flow decisions that aren't obvious from the code.

The codebase has **three entry points** that share the same DB:

1. **Agent API** (`app/api/agent/v1/...`): backend-to-backend, bearer-token auth via `Authorization: Bearer <key>`. Sessions are attributed to a `PartnerAgent` row.
2. **Participant API** (`app/api/participant/v1/...`): browser-side, authenticated by an invitation JWT on session creation, then a short-lived `participant_session` cookie for turns/complete. Sessions have `Chat.partnerAgentId = NULL`.
3. **Participant chat UI** (`app/chat/page.tsx`): the human-facing page. Entered via `/chat?t=<invitation-jwt>&rid=<qualtrics-response-id>`, normally as the End-of-Survey redirect from the PRE-interview Qualtrics survey. Renders against the participant API and (on completion) redirects to `QUALTRICS_FOLLOWUP_URL` if set. See "Qualtrics-first human flow" below.

The old `app/(chat)/` playground from the Vercel template was deleted in commit `5d1d036` and is *not* being restored. Ignore any README references to it.

Sessions are separated in queries by `Chat.partnerAgentId IS NULL` (human) vs `NOT NULL` (agent). Do not invent another discriminator.

## Common commands

Package manager is **pnpm@10** (`packageManager` in `package.json`). Use `pnpm`, not `npm`.

```bash
pnpm dev                  # next dev --turbo
pnpm build                # runs lib/db/migrate first, THEN next build (migrations apply on every build)
pnpm start
pnpm check                # ultracite check (Biome under the hood); this is the linter, NOT eslint
pnpm fix                  # ultracite fix
pnpm test                 # PLAYWRIGHT=True pnpm exec playwright test
```

Database (Drizzle ORM against Postgres/Supabase):

```bash
pnpm db:generate          # generate a migration from schema changes
pnpm db:migrate           # apply migrations (also runs implicitly on build)
pnpm db:studio
pnpm db:create-partner <name>          # mint a PartnerAgent + raw bearer key (printed once)
pnpm db:rotate-partner / db:unrevoke-partner / db:list-partners
pnpm db:create-invitations             # generate one-shot invitation JWTs pinned to a condition
pnpm db:create-entry-link              # mint THE reusable Qualtrics entry link (no arm pinned)
pnpm db:create-session-view            # SessionOverview view (already in prod)
pnpm db:create-session-transcript-view # SessionTranscript view (NOT yet run in prod; see goal.md)
pnpm db:export-sessions / db:export-transcripts / db:export-masterfile
pnpm db:audit / db:wipe-chat-data
```

Validation: use `pnpm build` (Next type-checks during build) rather than running `tsc --noEmit`. Don't use `eslint`; lint is Biome via `ultracite`.

End-to-end agent smoke test: `tsx scripts/e2e-agent-test.ts` (talks to `AGENT_API_BASE`, default `http://localhost:3000`).

## Architecture

### Three interviewer conditions (blinded as A/B/C)
`lib/study/conditions.ts` defines the study's three conditions as `A | B | C`. The real labels (`positive` / `neutral` / `disconfirmatory`) live **only** in `CONDITION_LABEL` in that file and in the DB `conditionLabel` columns; the rest of the stack uses A/B/C so logs, API responses, env var names, and UI text stay blinded. One deliberate exception: with `UNBLIND_FRONTEND=1` (staff/testing only, must be unset before real participants; it's on the pre-launch checklist) the participant session-creation response includes `condition`/`conditionLabel` and the chat UI shows an "Unblinded" badge. The full mapping is documented in `docs/conditions-mapping.md` (gitignored; do not commit and do not paste into chats or PRs).

Each condition is a pointer to an OpenAI Stored Prompt via env vars `OPENAI_A_PROMPT_ID` / `OPENAI_B_PROMPT_ID` / `OPENAI_C_PROMPT_ID` (+ optional `_VERSION`).

Condition selection:
- **Agent API (`POST /api/agent/v1/sessions`):** if `invitationToken` (JWT) is in the body, condition is whatever the token pinned. Otherwise `pickRandomCondition()` randomly assigns one. There is no direct `condition` field in the body schema; the random fallback exists to keep the study blinded.
- **Participant API (`POST /api/participant/v1/sessions`):** `invitationToken` is required, but it may or may not pin an arm. A token minted by `pnpm db:create-invitations --condition A|B|C` pins one (the original one-shot recruitment model). The Qualtrics **entry link** (`pnpm db:create-entry-link`) pins none — `Invitation.condition` is NULL — and the server draws simple-random at session creation. Drawing at session creation rather than at redirect means participants who click through and abandon before starting never consume an arm.

The chosen condition is written to `AgentSession.condition` (A/B/C) and `AgentSession.conditionLabel` (real label, staff-only) together with `promptId` + `promptVersion`, freezing the trial against later prompt edits.

### Agent API flow
`app/api/agent/v1/`:
- `keys/route.ts`: self-issue a PartnerAgent key (currently unauthenticated, IP-rate-limited only; see goal.md "Pre-launch audit checklist").
- `sessions/route.ts`: create chat + AgentSession. Idempotent on `(partner, participantExternalId)` if an active session exists; idempotent on `invitationToken` if already redeemed by the same caller.
- `sessions/[chatId]/turns/route.ts`: post one user message, server uses OpenAI Responses API with `previous_response_id` chain to maintain continuity. Callers never replay history.
- `sessions/[chatId]/complete/route.ts`: close the session.
- `sessions/[chatId]/route.ts` (GET): fetch full transcript.

### Qualtrics-first human flow (Study 2)

Humans go **Qualtrics → app → Qualtrics**:

1. **PRE survey** (device self-report, general self-efficacy, machine heuristic) ends in an End-of-Survey "Redirect to a URL" pointing at `<app>/chat?t=<entry-token>&rid=${e://Field/ResponseID}`. That URL is identical for every participant — print it with `pnpm db:create-entry-link --base-url <app>`.
2. **Interview** in the participant chat UI. The arm is drawn server-side; Qualtrics is never told which one.
3. **POST survey**, reached by the existing completion redirect, now carrying `rid` alongside `chat_id`, `participant_seq` and `completion_code`.

Two consequences of the entry link being reusable and public:

- **Identity comes from `rid`, not from the token.** The Qualtrics ResponseID is stored on `AgentSession.qualtricsResponseId` and used as `Participant.externalId`. It is the join key across pre-survey ↔ transcript ↔ post-survey; the arm is recovered by joining on it at analysis time.
- **Session creation is idempotent on `rid`.** A reload or back-button returns the in-progress chat plus its transcript (`resumed: true`) instead of starting a second interview; a completed one returns `409 already_completed`.

`Invitation.multiUse` marks a row reusable. The older `PARTICIPANT_INVITATIONS_REUSABLE=1` env flag still works but is a blunt instrument — it makes *every* invitation reusable — and is not how the live flow works.

### Auth model
- **Agent API**: `lib/agent-auth.ts` → `requireAgentAuth` → `sha256(bearerToken + APP_PEPPER)` lookup against `PartnerAgent.keyHash`. If `APP_PEPPER` is unset, the whole agent API returns `503 agent_api_disabled`. Rotating `APP_PEPPER` invalidates every existing partner key; reissue via `pnpm db:create-partner`.
- **Browser**: NextAuth (Auth.js v5 beta) in `app/(auth)/`, with a guest auth flow gated by `proxy.ts` at the repo root. Next.js 16 calls the file `proxy.ts` (not `middleware.ts`); `/api/agent/*` and `/agent-docs` pass through without an auth check.

### Data model
`lib/db/schema.ts`: Drizzle definitions. Key relationships:
- `Chat` carries both `partnerAgentId` (nullable) and `participantId`.
- `AgentSession` mirrors those for join convenience and adds the pinned `promptId`/`promptVersion`/`condition`/`conditionLabel`/`responseId`/`totalTokens`, `interviewerModel` (auto-captured from OpenAI response metadata), and `partnerModel` ("latest known" interviewee model, required on agent session creation, NULL on human sessions).
- `Participant` is uniquely `(partnerAgentId, externalId)` and backs each participant with a synthetic `User` so chat ownership FKs keep working.
- `Invitation` rows hold the JWT `jti`, condition, and redemption state.
- `Message_v2` is the transcript (role + parts + attachments + `partnerModel`): the primary study artifact. `partnerModel` is stamped on every user-turn row so per-turn history of the declared interviewee model is preserved; `SELECT chatId FROM "Message_v2" GROUP BY chatId HAVING COUNT(DISTINCT "partnerModel") > 1` surfaces mid-session model swaps.

When data could plausibly be queried with SQL, prefer dedicated columns over stuffing fields into `Participant.metadata` JSONB.

### Config & Next.js specifics
- `next.config.ts` enables `cacheComponents`, `reactCompiler`, and Turbopack file-system cache. Don't disable these casually.
- `IS_DEMO=1` switches the app to `basePath: "/demo"` with `/demo-assets` for static files; affects all internal URLs.
- `botid` wraps the config via `withBotId`.

## Conventions & gotchas

- **Lint via Biome/ultracite, not ESLint.** `biome.jsonc` extends `ultracite/biome/{core,next,react}` and the rules from `.cursor/rules/ultracite.mdc` apply: strict a11y, no `any` constraints, arrow functions over function expressions, `for...of` over `forEach`, etc.
- **Migrations run on `pnpm build`.** A build failure may be a migration failure; check the early output before assuming a TS error.
- **The `(chat)` playground was deleted** (commit `5d1d036`). The human chat path now lives at `app/chat/page.tsx` + the participant API; don't try to restore the deleted route.
- **OpenAI Stored Prompts live outside this repo.** The interviewer's wording is *not* in the codebase; it's referenced by `promptId` + `version`. To change interviewer behavior, edit the prompt in OpenAI, bump the version, and update the env var. The version in effect when a session was created is captured on `AgentSession.promptVersion` for reproducibility.
- **Server-side response chain.** Agent turns use OpenAI's `previous_response_id`; the previous response id is stored on the session. Don't try to thread message history through the request body.
- **`docs/goal.md` has a live "Deferred work" + "Pre-launch audit checklist" section.** Treat it as the project's roadmap; check it before proposing structural changes.

## Exported transcripts

`transcripts/` (gitignored; it contains unblinded condition labels) holds human-readable exports of completed sessions for sharing with collaborators outside the codebase:

- `transcripts/index.md`: summary table: one row per session with condition, source (human vs. agent), turn count, tokens, and links.
- `transcripts/<date>_<condition>_<chatId>.md`: readable transcript with metadata header and turn-by-turn dialogue (Interviewer / Interviewee Agent / Participant).
- `transcripts/<date>_<condition>_<chatId>.csv`: same content as columns: `turn, timestamp, role, speaker, text, partner_model`.
- `transcripts/trends.md`: qualitative analysis grouping sessions into behavioral patterns (responsive vs. scripted-loop interviewees, etc.) with relevant transcripts embedded inline.

Generated via `pnpm db:export-sessions` / `pnpm db:export-transcripts` (see `scripts/export-transcripts.ts`).

**Historical gotcha on the existing batch:** the first 12 exported sessions pre-date condition assignment being wired into the schema, so their `condition` is `NULL` and they render as `?` in the index. Only the last 4 (rows 13–16) are properly A/B/C-labeled. Many sessions from the `e2e-test-runner` partner are scripted-loop test traffic (the interviewee cycles through ~7 prewritten lines regardless of question); filter those out before drawing study conclusions.

## Required environment

Minimum to run the agent API locally (full list in `.env.example`):

- `AUTH_SECRET`, `POSTGRES_URL`, `REDIS_URL`: platform basics
- `APP_PEPPER`: required, gates the entire agent API
- `STUDY_OPENAI_API_KEY`: required for turns (named to avoid clashing with a globally-exported `OPENAI_API_KEY`)
- `OPENAI_A_PROMPT_ID` / `OPENAI_B_PROMPT_ID` / `OPENAI_C_PROMPT_ID` (+ optional `_VERSION` each): one per blinded condition. See `docs/conditions-mapping.md` for which letter maps to which study arm
- `INVITE_JWT_SECRET`: needed if you generate/verify invitation tokens
