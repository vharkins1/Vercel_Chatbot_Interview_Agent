<h1 align="center">Interview Agent</h1>

<p align="center">
    A research-study interview chatbot, forked from the Vercel AI Chat SDK template. The interviewer is an OpenAI Responses-API call against a Stored Prompt (id + version pinned per session). Each <code>Chat</code> row is one interview trial. See <a href="docs/goal.md"><code>docs/goal.md</code></a> for the study design and the live roadmap.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a> ·
  <a href="#three-entry-points"><strong>Entry points</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - React Server Components (RSCs) and Server Actions for server-side rendering
- OpenAI Responses API interviewer
  - Each blinded condition points to an OpenAI Stored Prompt; the prompt id + version are pinned per session so mid-study prompt edits don't invalidate prior trials
  - Conversation continuity is kept server-side via the previous OpenAI response id, so callers never replay history
- Styling with [Tailwind CSS](https://tailwindcss.com) and a small set of [Radix UI](https://radix-ui.com) primitives for accessibility
- Data persistence in Postgres via [Drizzle ORM](https://orm.drizzle.team) (chats, messages, agent sessions, participants, invitations, survey handoff)
- [Auth.js](https://authjs.dev) for browser authentication; bearer-token auth for the agent API

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Chatbot. It's recommended you use [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables) for this, but a `.env` file is all that is necessary.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various AI and authentication provider accounts.

1. Install Vercel CLI: `npm i -g vercel`
2. Link local instance with Vercel and GitHub accounts (creates `.vercel` directory): `vercel link`
3. Download your environment variables: `vercel env pull`

```bash
pnpm install
pnpm db:migrate # Setup database or apply latest database changes
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000).

## Three entry points

The app has three ways to talk to the interview bot. They share the same DB but have separate auth and surface area.

### 1. Agent API (backend-to-backend, for partner AI agents)

- `POST /api/agent/v1/keys` — self-issue a bearer key.
- `POST /api/agent/v1/sessions` — start an interview session.
- `POST /api/agent/v1/sessions/:chatId/turns` — send the next user message.
- `POST /api/agent/v1/sessions/:chatId/complete` — close the session.
- `GET  /api/agent/v1/sessions/:chatId` — fetch the full transcript.

Auth: `Authorization: Bearer <key>`. Every call is attributed to a `PartnerAgent` row (resolved from the bearer token) and a `Participant` row (upserted by `(partnerAgentId, participantExternalId)`).

### 2. Participant API (browser-side, for humans)

- `POST /api/participant/v1/sessions` — start a session (body: `{ invitationToken }`).
- `POST /api/participant/v1/sessions/:chatId/turns` — send a message.
- `POST /api/participant/v1/sessions/:chatId/complete` — close the session.

Auth: a one-shot invitation JWT (`invitationToken` in the create body), then a short-lived `participant_session` cookie for subsequent calls. Sessions have `Chat.partnerAgentId = NULL`.

### 3. Participant chat UI (`/chat?t=<invitation-jwt>`)

The human-facing landing page. Renders against the participant API. On mount it fires a hidden seed turn so the interviewer opens the conversation; on completion it redirects to `QUALTRICS_FOLLOWUP_URL` if set.

Sessions split cleanly by interaction type: `Chat.partnerAgentId IS NOT NULL` ⇒ agent session; `IS NULL` ⇒ human session. Filter on that column to separate the populations in any analysis.

```text
Authorization: Bearer <partner-api-key>
Content-Type: application/json
```

Create one agent session. `partnerModel` is **required**; the server has no other way to know which model is on the other side of the interview. Multiple sessions for the same `participantExternalId` group together as a longitudinal series:

```bash
BASE="https://your-deployment.vercel.app"
API_KEY="<partner-api-key>"

CHAT_ID=$(
  curl -s -X POST "$BASE/api/agent/v1/sessions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Terminal interview",
      "participantExternalId": "subject-001",
      "partnerModel": "claude-sonnet-4-5"
    }' \
  | jq -r '.chatId'
)

echo "$CHAT_ID"
```

`participantExternalId` is the partner's stable identifier for the participant (e.g. an agent's own session id) — any opaque string ≤ 200 chars. Repeated calls with the same `(partner, participantExternalId)` resolve to the same `Participant` row, so multiple sessions for the same participant stay grouped.

If no `invitationToken` is supplied, the server randomly assigns one of three blinded conditions (`A` / `B` / `C`). The chosen condition is returned in the response body and stamped on `AgentSession.condition`; the descriptive label (positive / neutral / disconfirmatory) is **not** returned and lives only in `AgentSession.conditionLabel` and `docs/conditions-mapping.md` (gitignored).

When a session is created, the active OpenAI Stored Prompt id and version are pinned on the `AgentSession` row (`promptId`, `promptVersion`) so prompt edits mid-study don't silently invalidate prior trials. After each turn the server adds the call's `usage.total_tokens` to a running `AgentSession.totalTokens`. See [`docs/study-data-model.md`](docs/study-data-model.md) for the full data spec.

Then continue the conversation by reusing the same `CHAT_ID` and posting only the next user message. Re-send `partnerModel` only if it changed since the last turn (last write wins on the session column; the value is also stamped on each user-turn row in `Message_v2.partnerModel` for per-turn audit):

```bash
curl -s -X POST "$BASE/api/agent/v1/sessions/$CHAT_ID/turns" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Start the interview."}' \
  | jq -r '.assistantMessage.parts[0].text'

curl -s -X POST "$BASE/api/agent/v1/sessions/$CHAT_ID/turns" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Yes, I agree to proceed."}' \
  | jq -r '.assistantMessage.parts[0].text'
```

The agent API stores conversation continuity server-side with the session's previous OpenAI response id, so the caller does not need to send or fetch the whole transcript for every turn. Use `GET /api/agent/v1/sessions/:chatId` only when you need the transcript for display, audit, export, or debugging.

Important: a browser chat ID is not the same as a usable agent session ID. Agent turns require an `AgentSession` row created by `POST /api/agent/v1/sessions`; otherwise the turn endpoint returns `no_agent_session`.

## Agent API provisioning

The bearer-authenticated agent API writes normal `Chat`, `Message_v2`, and `AgentSession` rows. Each call is attributed to a row in `PartnerAgent` (resolved from the bearer token) and a row in `Participant` (upserted by `(partnerAgentId, participantExternalId)`). Each `Participant` is linked to an auto-created anonymous `User` row so the existing chat-ownership queries keep working.

Required environment variables (see `.env.example` for the full list):

- `APP_PEPPER`: server-side pepper used to hash partner API keys at rest. 32+ random bytes, base64. Rotating this invalidates every existing partner key.
- `STUDY_OPENAI_API_KEY`: used by interview turns through the OpenAI Responses API. (Named with the `STUDY_` prefix so a globally-exported `OPENAI_API_KEY` in your shell doesn't shadow it.)
- `OPENAI_A_PROMPT_ID`, `OPENAI_B_PROMPT_ID`, `OPENAI_C_PROMPT_ID` (+ optional `_VERSION` per arm): one stored prompt per blinded condition. See `docs/conditions-mapping.md` (gitignored) for which letter maps to which study arm.
- `INVITE_JWT_SECRET`: signs invitation JWTs and the participant session cookie.

Optional helpers:

- `AGENT_API_BASE`: base URL for `scripts/e2e-agent-test.ts`; defaults to `http://localhost:3000`.
- `QUALTRICS_FOLLOWUP_URL`: where the participant chat UI redirects on `/complete`.

Most callers self-issue keys via `POST /api/agent/v1/keys` (see the Agent API section above). For operator-minted keys, after migrations are applied:

```bash
pnpm db:migrate
pnpm db:create-partner agent
# created partner agent: agent (<uuid>)
#
# API key (shown once — capture and share OOB):
# <raw-key>
```

Revoke a key by name (self-issued partners are named `<label>-<random>`):

```sql
UPDATE "PartnerAgent" SET "revokedAt" = now() WHERE name = 'agent-<random>';
```

After an agent smoke test, inspect attribution + per-session totals:

```sql
SELECT c.id, c.title, c."createdAt",
       pa.name           AS partner,
       p."externalId"    AS participant,
       s."promptVersion",
       s."totalTokens",
       s."completedAt"
FROM "Chat" c
JOIN "PartnerAgent" pa ON pa.id = c."partnerAgentId"
JOIN "Participant"  p  ON p.id  = c."participantId"
JOIN "AgentSession" s  ON s."chatId" = c.id
ORDER BY c."createdAt" DESC
LIMIT 5;
```

Pull the transcript for one chat (the primary study artifact):

```sql
SELECT role, parts, "createdAt"
FROM "Message_v2"
WHERE "chatId" = '<chat-id>'
ORDER BY "createdAt";
```
