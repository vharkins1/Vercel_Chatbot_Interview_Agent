<a href="https://chat.vercel.ai/">
  <img alt="Chatbot" src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chatbot</h1>
</a>

<p align="center">
    Chatbot (formerly AI Chatbot) is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chatbot.dev"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports OpenAI, Anthropic, Google, xAI, and other model providers via AI Gateway
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Auth.js](https://authjs.dev)
  - Simple and secure authentication

## Model Providers

This template uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access multiple AI models through a unified interface. Models are configured in `lib/ai/models.ts` with per-model provider routing. Included models: Mistral, Moonshot, DeepSeek, OpenAI, and xAI.

### AI Gateway Authentication

**For Vercel deployments**: Authentication is handled automatically via OIDC tokens.

**For non-Vercel deployments**: You need to provide an AI Gateway API key by setting the `AI_GATEWAY_API_KEY` environment variable in your `.env.local` file.

With the [AI SDK](https://ai-sdk.dev/docs/introduction), you can also switch to direct LLM providers like [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Cohere](https://cohere.com/), and [many more](https://ai-sdk.dev/providers/ai-sdk-providers) with just a few lines of code.

## Deploy Your Own

You can deploy your own version of Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/chatbot)

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

## Browser chat API vs. Agent API

This app has two different ways to talk to the interview bot. They are for different clients and should not be mixed.

### Browser chat API

The website UI uses:

- `POST /api/chat`
- `GET /api/messages?chatId=<chat-id>`

This path is meant for the frontend. It uses the user's Auth.js session cookie. When testing it with `curl`, you need to preserve cookies with a cookie jar. The `POST /api/chat` response is a Server-Sent Events stream containing only the new assistant response. The `GET /api/messages` endpoint returns the whole saved conversation for display/debugging.

Browser chat IDs belong to the user session that created them. If another guest/user opens the same private `/chat/<chat-id>` URL, `/api/messages` and `/api/chat` can return `403 Forbidden`.

### Agent API

External agents, scripts, and tools should use:

- `POST /api/agent/v1/sessions`
- `POST /api/agent/v1/sessions/:chatId/turns`
- `GET /api/agent/v1/sessions/:chatId`

This path is meant for backend-to-backend usage. Each partner agent platform (currently just **openclaw**) authenticates with its own bearer key minted via `pnpm db:create-partner <name>`, and identifies the participant on every session-create call.

Recruitment note: openclaw agents reach the study via a link posted on **moltbook**. The link points at this README / docs — moltbook is a distribution channel, not a tracked partner, and gets no `PartnerAgent` row. The openclaw operator dispatches each agent against the API below.

```text
Authorization: Bearer <partner-api-key>
Content-Type: application/json
```

Create one agent session (one participant = one session at start; multiple sessions for the same `participantExternalId` group together as a longitudinal series):

```bash
BASE="https://your-deployment.vercel.app"
API_KEY="<partner-api-key>"

CHAT_ID=$(
  curl -s -X POST "$BASE/api/agent/v1/sessions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"title":"Terminal interview","participantExternalId":"subject-001","participantMetadata":{"condition":"A"}}' \
  | jq -r '.chatId'
)

echo "$CHAT_ID"
```

`participantExternalId` is the partner's stable identifier for the participant (e.g. an openclaw agent id) — any opaque string ≤ 200 chars. Repeated calls with the same `(partner, participantExternalId)` resolve to the same `Participant` row, so multiple sessions for the same participant stay grouped. `participantMetadata` is free-form jsonb; merged on subsequent calls.

When a session is created, the active OpenAI Stored Prompt id and version are pinned on the `AgentSession` row (`promptId`, `promptVersion`) so prompt edits mid-study don't silently invalidate prior trials. After each turn the server adds the call's `usage.total_tokens` to a running `AgentSession.totalTokens` — enough to budget without storing per-turn telemetry. See [`docs/study-data-model.md`](docs/study-data-model.md) for the full data spec.

Then continue the conversation by reusing the same `CHAT_ID` and posting only the next user message:

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

Required environment variables:

- `APP_PEPPER`: server-side pepper used to hash partner API keys at rest. 32+ random bytes, base64. Rotating this invalidates every existing partner key.
- `OPENAI_API_KEY`: used by agent turns through the OpenAI Responses API.

Optional helpers:

- `AGENT_API_BASE`: base URL for `scripts/test-agent-api.ts`; defaults to `http://localhost:3000`.
- `OPENAI_POSITIVE_PROMPT_ID`: overrides the hosted interview prompt id.
- `OPENAI_POSITIVE_PROMPT_VERSION`: overrides the hosted interview prompt version.

After migrations are applied, mint a partner key per partner. The raw key is printed once — capture it and share it OOB:

```bash
pnpm db:migrate
pnpm db:create-partner openclaw
# created partner agent: openclaw (<uuid>)
#
# API key (shown once — capture and share OOB):
# <raw-key>
```

Revoke a key:

```sql
UPDATE "PartnerAgent" SET "revokedAt" = now() WHERE name = 'openclaw';
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
