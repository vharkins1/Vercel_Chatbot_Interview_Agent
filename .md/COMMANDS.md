# Repository Command Catalog

Last reviewed: 2026-09-14

Use this file when the user asks for “known commands,” link-generation commands, Supabase exports, transcript exports, or verification tasks. Run commands from the repository root. Prefer `corepack pnpm` in shells where `pnpm` is unavailable.

Never copy secrets, raw API keys, invitation tokens, participant data, condition labels, or transcripts into this file. Files under `transcripts/` are private study data and are gitignored.

## Quick lookup

| User asks for | Command |
|---|---|
| One readable conversation by ChatID | `pnpm db:export-conversation <ChatID>` |
| All conversation transcripts | `pnpm db:export-transcripts` |
| Session summary CSV | `pnpm db:export-sessions > transcripts/sessions.csv` |
| Agent/Qualtrics master CSV | `pnpm db:export-masterfile` |
| Reusable Qualtrics entry link | `pnpm db:create-entry-link --base-url https://<app> [--ttl-days 180] [--label <label>]` |
| One-shot recruitment links/tokens | `pnpm db:create-invitations --count <N> [--condition A|B|C|DEV|mixed] [--batch <label>] [--multi-use]` |
| Count participants | `pnpm db:count-participants` |
| Read-only database row counts | `pnpm db:audit` |
| Check survey handoff configuration | `pnpm verify:handoff` |
| Start the local app | `pnpm dev` |

## Conversation and Supabase exports

These commands require `POSTGRES_URL` in `.env.local` unless stated otherwise.

### Export one conversation as readable Markdown

```bash
pnpm db:export-conversation <ChatID>
```

- Requires a valid UUID ChatID.
- Exports only that chat, with ChatID, Pacific date/time, condition, prompt ID/version, interviewer model, and chronological messages.
- Writes `transcripts/<Pacific-timestamp>_<full-ChatID>/transcript.md` and opens it.
- Optional output root: set `TRANSCRIPTS_OUT`.
- Fallback when `pnpm` is unavailable: `./node_modules/.bin/tsx scripts/export-conversation.ts <ChatID>`.
- Source: `scripts/export-conversation.ts`, `scripts/export-conversation.md`.

### Export all readable transcripts

```bash
pnpm db:export-transcripts
```

- Writes per-conversation Markdown and CSV files plus `transcripts/index.md`.
- Includes unblinded staff metadata. Keep the output private and out of commits.
- Optional output root: set `TRANSCRIPTS_OUT`.
- Source: `scripts/export-transcripts.ts`.

### Export session overview CSV

```bash
pnpm db:export-sessions > transcripts/sessions.csv
```

- Reads the `SessionOverview` view and prints CSV to stdout.
- The view must already exist; create it with `pnpm db:create-session-view` only when an authorized schema change is intended.
- Source: `scripts/export-sessions.ts`.

### Export the agent-study master file

```bash
pnpm db:export-masterfile
pnpm db:export-masterfile --out transcripts/<filename>.csv
```

- Writes one row per agent interview, joining Supabase session data to Qualtrics linkage fields.
- Includes blinded and unblinded condition values; staff-only.
- Default output: `transcripts/masterfile_<YYYY-MM-DD>.csv`.
- Source: `scripts/export-masterfile.ts`.

### Export raw message rows

```bash
pnpm exec tsx scripts/export-messages.ts > transcripts/messages.csv
```

- Prints all `Message_v2` rows as CSV, including extracted text and raw parts JSON.
- Lower-level/private export; prefer the readable transcript commands unless raw parts are required.
- Source: `scripts/export-messages.ts`.

## Link and invitation generation

These commands write invitation records to Supabase and print sensitive bearer tokens. Run only on explicit request. Share outputs out of band; never store them in Markdown or commit them.

### Reusable Qualtrics-first participant entry link

```bash
pnpm db:create-entry-link --base-url https://<app> [--ttl-days 180] [--label <label>]
```

- Requires `POSTGRES_URL` and `INVITE_JWT_SECRET` in `.env.local`.
- Produces one multi-use URL with no condition pinned. The server assigns the condition when each session is created.
- Paste the printed URL into the PRE survey’s End-of-Survey redirect.
- The POST survey must declare the join fields identified by the command before its first block.
- Source: `scripts/create-entry-link.ts`.

### One-shot or condition-pinned recruitment invitations

```bash
pnpm db:create-invitations --count <N> [--condition A|B|C|DEV|mixed] [--batch <label>] [--multi-use]
```

- Requires `POSTGRES_URL` and `INVITE_JWT_SECRET`.
- Default condition mode is `mixed`; output tokens are printed once.
- Without `--multi-use`, each token is one-shot.
- Caution: the current `--ttl-days` branch in `scripts/create-invitations.ts` does not assign the supplied value, so the effective lifetime remains the 30-day default. Do not claim a custom lifetime until that parser is fixed and verified.
- Source: `scripts/create-invitations.ts`.

## Partner-agent credentials

These commands affect authentication. Raw keys are printed once. Never run, rotate, restore, or share a credential without explicit authorization from the credential owner.

```bash
pnpm db:create-partner <name>
pnpm db:rotate-partner <name>
pnpm db:unrevoke-partner <name>
pnpm db:list-partners
```

- Create and rotate require `POSTGRES_URL` and `APP_PEPPER`.
- `db:create-partner` creates a partner and prints its new API key once.
- `db:rotate-partner` invalidates the old key and prints the replacement once.
- `db:unrevoke-partner` re-enables the named partner.
- `db:list-partners` lists partner records without exposing raw keys.
- Sources: `scripts/create-partner-agent.ts`, `scripts/rotate-partner-key.ts`, `scripts/unrevoke-partner.ts`, `scripts/list-partners.ts`.

## Read-only diagnostics and counts

```bash
pnpm db:audit
pnpm db:count-participants
pnpm exec tsx scripts/diagnose-survey.ts
```

- `db:audit`: read-only row counts across core Supabase tables.
- `db:count-participants`: numbered participant totals, split by human/agent and survey-submission status.
- `diagnose-survey.ts`: reads the live Qualtrics definition and recent Supabase submissions; requires the configured Qualtrics variables for the remote survey portion.
- Sources: `scripts/audit-data.ts`, `scripts/count-participants.ts`, `scripts/diagnose-survey.ts`.

## Survey and end-to-end verification

```bash
pnpm verify:handoff
pnpm verify:handoff --live
AGENT_API_KEY=<key> AGENT_API_BASE=https://<app> pnpm exec tsx scripts/e2e-agent-test.ts
AGENT_API_BASE=https://<app> pnpm exec tsx scripts/e2e-survey-test.ts
AGENT_API_BASE=https://<app> pnpm e2e:trace
pnpm test
```

- `verify:handoff`: read-only configuration preflight.
- `verify:handoff --live`: creates a real local interview, verifies the Qualtrics handoff, and deletes its test rows; requires a running app and configured services.
- `e2e-agent-test.ts`: drives the agent API; requires `AGENT_API_KEY`, with optional `INVITATION_TOKEN` and `PARTNER_MODEL`.
- `e2e-survey-test.ts`: drives an interview and every survey page, verifies Qualtrics join keys, then removes the created Qualtrics and Supabase test data. Requires `POSTGRES_URL` and Qualtrics credentials in the environment.
- `e2e:trace`: detailed agent-path trace; `SMOKE_NO_CLEANUP=1` deliberately preserves generated test data and should not be used casually.
- `pnpm test`: runs the Playwright suite with `PLAYWRIGHT=True`.
- Sources: `scripts/verify-survey-handoff.ts`, `scripts/e2e-agent-test.ts`, `scripts/e2e-survey-test.ts`, `scripts/trace-agent-e2e.ts`, `package.json`.

## Local application and focused checks

```bash
pnpm install
pnpm dev
pnpm build
pnpm start
pnpm check
pnpm fix
```

- `pnpm dev`: Next.js development server with Turbopack.
- `pnpm build`: runs database migrations first, then builds Next.js. Because it can change the configured database, do not treat it as a read-only type check.
- `pnpm start`: serves an existing production build.
- `pnpm check`: Ultracite/Biome checks.
- `pnpm fix`: rewrites files; run only when formatting changes are intended.
- Source: `package.json`, `CLAUDE.md`.

## Database schema commands

Schema commands can change the configured Supabase database. Inspect and commit generated migrations before applying them.

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm db:push
pnpm db:pull
pnpm db:check
pnpm db:up
pnpm db:create-session-view
pnpm db:create-session-transcript-view
```

- `db:generate`: generate migration SQL from schema changes.
- `db:migrate`: apply committed migrations.
- `db:studio`: open Drizzle Studio.
- `db:push`, `db:pull`, `db:up`: direct schema operations; use only with a reviewed migration plan.
- `db:check`: inspect migration consistency.
- View-creation commands materialize reporting views. Repository notes say `SessionTranscript` may not yet exist in production; do not create it without explicit authorization.
- Sources: `package.json`, `lib/db/migrate.ts`, `scripts/create-session-view.ts`, `scripts/create-session-transcript-view.ts`, `docs/goal.md`.

## Administrative and destructive maintenance

Never run these merely to “clean up.” They intentionally mutate or delete stored study data.

```bash
pnpm db:ensure-survey-fields
pnpm db:wipe-chat-data
pnpm exec tsx scripts/reset-participant-seq.ts
pnpm exec tsx scripts/backfill-ip-hash.ts
```

- `db:ensure-survey-fields`: mutates the live Qualtrics survey flow to add required embedded-data declarations.
- `db:wipe-chat-data`: truncates chat, message, session, participant, invitation, and user data; destructive.
- `reset-participant-seq.ts`: deletes every numbered test session and associated data, then resets the participant sequence to 1; destructive.
- `backfill-ip-hash.ts`: one-off migration step valid only between migrations 0020 and 0021, using the production hash pepper; not a routine command.
- Sources: `scripts/ensure-survey-fields.ts`, `scripts/wipe-chat-data.ts`, `scripts/reset-participant-seq.ts`, `scripts/backfill-ip-hash.ts`.

## Model task rules

When asked for a known command:

1. Read this catalog instead of reconstructing syntax from memory.
2. State whether the command is read-only, writes records, exposes a one-time token, changes schema, contacts Qualtrics, or deletes data.
3. Replace placeholders such as `<ChatID>`, `<app>`, `<N>`, and `<name>` only with values the user supplied or values safely obtained from the repository/runtime.
4. Never print `.env.local`, connection strings, credentials, invitation tokens, participant data, unblinded condition data, or transcript content into chat unless the user explicitly requests that exact private output and is authorized.
5. For destructive, production-writing, schema, key-rotation, or live-survey commands, explain the effect and obtain explicit authorization before execution.

For bug fixes and restoration work, do not report “fixed” unless the exact product path that failed for the user has been tested successfully. Record the real scenario in `.md/HANDOFF.md`, including entry point, model/account/session if relevant, expected result, observed result, and any remaining failure. Isolated smoke tests or quota checks can support the diagnosis but are not sufficient by themselves.

After completing any fix, diagnostic pass, command run, or verification attempt, provide a short results summary: what happened, what changed, what was verified, what remains unverified or failed, and what should happen next. Separate observed facts from conclusions.
