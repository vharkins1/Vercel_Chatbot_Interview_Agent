# Study data model spec

The study captures interview sessions across two independent axes — **per-participant** and **per-agent** — plus enough session-level metadata to know which prompt produced the transcript and roughly how much it cost. The transcript itself is the primary artifact; we deliberately don't record per-turn telemetry. This doc is the source of truth for what we store and why; `lib/db/schema.ts` is the implementation.

This supersedes the earlier "drop participant tracking" plan.

## Entities

### `User`
Already exists. Backs both human web users and synthetic per-participant users. Synthetic users have `isAnonymous = true` and a `participant-<uuid>@partner.invalid` email so the existing FKs (chat ownership, documents, suggestions) work without special-casing.

### `PartnerAgent`
One row per partner that delivers participants. Self-issued keys (via `POST /api/agent/v1/keys`) create one row per key, named `<label>-<random>`; operator-minted keys (`pnpm db:create-partner <name>`) use the supplied name. Browser/Human sessions have no `PartnerAgent` row attached to their `Chat` (`partnerAgentId IS NULL`).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text unique | Display name; used in CLI / docs. |
| `keyHash` | text unique | sha256(rawKey + `APP_PEPPER`). |
| `createdAt` | timestamp | |
| `revokedAt` | timestamp nullable | If set, auth fails. |
| `lastUsedAt` | timestamp nullable | Best-effort touch on each authed request. |

### `Participant`
One row per interviewee enrolled by a partner agent.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `partnerAgentId` | uuid FK → `PartnerAgent` | Cascade delete with the partner. |
| `externalId` | text | Stable id from the partner. Unique with `partnerAgentId`. |
| `userId` | uuid FK → `User` | Synthetic user that owns this participant's chats. |
| `metadata` | jsonb nullable | Free-form: demographics, consent, recruitment source, anything the partner sends. Merged on upsert. |
| `createdAt` | timestamp | First time we saw this participant. |

Unique index on `(partnerAgentId, externalId)`. The same human reached via a different partner would be a separate row — we do not attempt to dedupe across partners.

### `Chat`
Already exists; carries study attribution.

Added/kept columns:
- `partnerAgentId` uuid FK → `PartnerAgent`, nullable (null = web/dev chat).
- `participantId` uuid FK → `Participant`, nullable (null = web/dev chat).
- CHECK constraint: `partnerAgentId` and `participantId` are either both set or both null. Prevents half-attributed rows.

### `AgentSession`
One row per agent-driven session, 1:1 with `Chat` (via `chatId` unique).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `chatId` | uuid unique FK → `Chat` | |
| `userId` | uuid FK → `User` | Mirrors `Chat.userId` — the synthetic participant user. |
| `partnerAgentId` | uuid FK → `PartnerAgent` | Mirror for join convenience. |
| `participantId` | uuid FK → `Participant` | Mirror for join convenience. |
| `responseId` | text nullable | Most recent OpenAI Responses-API id; used as `previous_response_id` next turn. |
| `instructions` | text nullable | Per-session instructions override sent at create time. |
| `promptId` | text | Which OpenAI Stored Prompt is in use for this session. Pinned at create. |
| `promptVersion` | text | Pinned version for this session. Edits to the OpenAI prompt mid-study won't silently invalidate prior trials. |
| `condition` | text nullable | One of `positive` / `neutral` / `negative`, copied from the redeemed `Invitation`. Selects which prompt id was pinned. |
| `interviewerModel` | text nullable | Our system's model, captured automatically from `response.model` in the OpenAI Responses API on the first turn that returns a value. |
| `partnerModel` | text nullable | Self-declared model id of the partner agent (the interviewee). Sent in the request body on `POST /sessions` and/or `POST /turns`. Last write wins. |
| `totalTokens` | integer | Running sum across all turns in this session. Updated after each `/turns` call. Lets us budget and audit cost without storing anything per turn. |
| `createdAt` | timestamp | |
| `completedAt` | timestamp nullable | Set by `POST /complete`. |

Same CHECK as `Chat`: `partnerAgentId` and `participantId` paired.

### `Invitation`
One row per minted invitation token. Each token is a one-shot capability that pins a session to a specific condition.

| Field | Type | Notes |
|---|---|---|
| `jti` | text PK | JWT id, also the row identity. |
| `condition` | text | `positive` / `neutral` / `negative`. Determines which OpenAI prompt the redeeming session uses. |
| `expiresAt` | timestamp | Defense-in-depth alongside the JWT `exp` claim. |
| `createdAt` | timestamp | |
| `redeemedAt` | timestamp nullable | Set atomically on first successful redeem. |
| `redeemedByChatId` | uuid nullable | The chat that consumed this invitation. |
| `redeemedByExternalId` | text nullable | The participant who consumed it. |
| `batchLabel` | text nullable | Free-form label so an operator can group a research batch. |

Tokens are minted via `pnpm db:create-invitations --count N --batch <label>`. Redemption is via `POST /sessions { invitationToken }`; the route does an atomic `UPDATE … WHERE redeemedAt IS NULL RETURNING condition`, so concurrent redeems return `409 already_redeemed` to all but one.

### `Message_v2`
Already exists; transcript rows. **This is the study's primary artifact** — every question and answer is here, keyed by `chatId` and ordered by `createdAt`. No schema change.

## What we deliberately don't store

- **Per-turn telemetry** (latency, finish reason, per-call token usage). Out of scope; `totalTokens` on `AgentSession` is enough.
- **Raw OpenAI responses.** Transcript text is what matters for analysis.
- **Per-message edit history.** The agent flow doesn't allow edits.

## Migrations

The partner/participant attribution work is already captured in
`lib/db/migrations/0005_flashy_tenebrous.sql`. It creates `PartnerAgent` and
`Participant`, adds `partnerAgentId` / `participantId` to `Chat` and
`AgentSession`, adds the pair-or-null CHECK constraints, and removes rows from
the previous single shared service-user model.

The session-level prompt/token work is captured in
`lib/db/migrations/0006_old_silk_fever.sql`:

```sql
ALTER TABLE "AgentSession" ADD COLUMN "promptId" text;
ALTER TABLE "AgentSession" ADD COLUMN "promptVersion" text;
ALTER TABLE "AgentSession" ADD COLUMN "totalTokens" integer DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS "AgentSession_partnerAgentId_idx" ON "AgentSession" USING btree ("partnerAgentId");
CREATE INDEX IF NOT EXISTS "AgentSession_participantId_idx" ON "AgentSession" USING btree ("participantId");
CREATE INDEX IF NOT EXISTS "Chat_partnerAgentId_idx" ON "Chat" USING btree ("partnerAgentId");
CREATE INDEX IF NOT EXISTS "Chat_participantId_idx" ON "Chat" USING btree ("participantId");
```

## Code state

### `lib/db/schema.ts`
- Defines `PartnerAgent`, `Participant`, and the `(partnerAgentId, externalId)` unique index.
- Adds `partnerAgentId` / `participantId` to `Chat` and `AgentSession`.
- Adds `promptId`, `promptVersion`, `totalTokens`, and attribution indexes.

### `lib/db/queries.ts`
- `upsertParticipant` creates or reuses the participant and merges metadata on conflict.
- `createAgentChatAndSession` writes `Chat` and `AgentSession` together, including prompt pinning fields.
- `incrementAgentSessionTokens` atomically adds OpenAI `usage.total_tokens` on a best-effort basis.

### `lib/agent-auth.ts`
- Resolves bearer tokens through `PartnerAgent.keyHash` using sha256(rawKey + `APP_PEPPER`).
- Rejects revoked keys and updates `lastUsedAt` best-effort.

### `app/api/agent/v1/sessions/route.ts`
Body schema (POST):
```ts
{
  chatId?: string,
  title?: string,
  instructions?: string,
  participantExternalId: string,           // required
  participantMetadata?: Record<string, unknown>,
  invitationToken: string,                 // required — selects condition + prompt
  partnerModel?: string,                   // recommended — interviewee model id
}
```
Steps:
1. `requireAgentAuth`.
2. `verifyInvitation(invitationToken)` → JWT claims (`{ jti, condition, exp }`).
3. Look up the row by `jti`, fail if expired or missing. Idempotent retry: if the same `(jti, externalId)` pair has already been redeemed, return that `chatId` + `condition` with `idempotent: true`.
4. `upsertParticipant({ partnerAgentId, externalId, metadata })`.
5. `redeemInvitation({ jti, chatId, externalId })` — atomic UPDATE with a `redeemedAt IS NULL` guard. Returns the `condition` on success.
6. `promptForCondition(condition)` → `(promptId, promptVersion)` for the OpenAI Stored Prompt that condition is bound to.
7. `createAgentChatAndSession({ chatId, partnerAgentId, participantId, userId: participant.userId, title, instructions, promptId, promptVersion, condition, partnerModel })`.

### `app/api/agent/v1/sessions/[chatId]/turns/route.ts`
Uses the session-pinned `promptId` / `promptVersion`. After a successful OpenAI call, it:
- saves the user + assistant `Message_v2` rows,
- updates `AgentSession.responseId`,
- captures `response.model` into `AgentSession.interviewerModel` if that column was null,
- updates `AgentSession.partnerModel` if the request body included a new value,
- increments `AgentSession.totalTokens` by `response.usage?.total_tokens ?? 0`.

Body schema:
```ts
{
  text: string,                  // required, ≤ 8000 chars
  messageId?: string,            // uuid; lets caller pre-assign the user msg id
  partnerModel?: string,         // last-write-wins update of AgentSession.partnerModel
}
```

### `app/api/agent/v1/sessions/[chatId]/complete/route.ts`
No change beyond setting `completedAt`.

### `app/api/agent/v1/sessions/[chatId]/route.ts` (GET)
Return the new `AgentSession` fields (`promptId`, `promptVersion`, `totalTokens`) so partners can self-audit.

### `scripts/create-partner-agent.ts`
Creates a `PartnerAgent` row and prints the raw API key once.

### `README.md`
Documents agent API usage, partner key provisioning, prompt env vars, and study data queries.

## Verification

```bash
PROD=https://<latest-prod-url>
KEY=<raw key (self-issued via /api/agent/v1/keys, or operator-minted)>

# Start a session for participant P-001.
CHAT_ID=$(curl -s -X POST "$PROD/api/agent/v1/sessions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "title": "trial 1",
    "participantExternalId": "P-001",
    "participantMetadata": { "lang": "en", "consent": true }
  }' | jq -r .chatId)

curl -s -X POST "$PROD/api/agent/v1/sessions/$CHAT_ID/turns" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "text": "hello" }' | jq

curl -s -X POST "$PROD/api/agent/v1/sessions/$CHAT_ID/complete" \
  -H "Authorization: Bearer $KEY" | jq
```

One row per session, joined to participant, with token total:

```sql
SELECT
  pa.name           AS partner,
  p."externalId"    AS participant,
  c.id              AS chat_id,
  s."promptVersion",
  s."createdAt",
  s."completedAt",
  s."totalTokens"
FROM "AgentSession" s
JOIN "Chat" c          ON c.id = s."chatId"
JOIN "PartnerAgent" pa ON pa.id = s."partnerAgentId"
JOIN "Participant" p   ON p.id = s."participantId"
ORDER BY s."createdAt" DESC
LIMIT 25;
```

Per-participant longitudinal pull:

```sql
SELECT c.id, s."createdAt", s."totalTokens"
FROM "Chat" c
JOIN "AgentSession" s ON s."chatId" = c.id
JOIN "Participant" p  ON p.id = c."participantId"
WHERE p."externalId" = 'P-001'
ORDER BY s."createdAt";
```

Pull a transcript:

```sql
SELECT role, parts, "createdAt"
FROM "Message_v2"
WHERE "chatId" = '<chat-id>'
ORDER BY "createdAt";
```

## What stays the same

- Per-agent API keys and `requireAgentAuth` (`PartnerAgent` table, sha256+pepper auth, `lastUsedAt`, `revokedAt`).
- The four route paths and their request shapes (additions only — no breaking field renames).
- The web chat UI flow — unchanged. Web chats have null `partnerAgentId` / `participantId`; partner chats have both.
- `APP_PEPPER` env var.
