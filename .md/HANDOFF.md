# Shared Model Handoff

Last updated: 2026-09-14

This file is the durable communication and verification ledger for GPT, Claude, and other OMP models. Do not place secrets, authentication material, participant data, or transcript text here.

## Status vocabulary

- `implemented`: code exists but may not have behavioral proof.
- `verified`: the recorded command or scenario ran and passed.
- `blocked`: a named external input or authorization is required; do not retry until it is provided.
- `failed`: verification ran and produced the recorded failure.

## Active objective

The developer conversation-export feature is implemented and behaviorally verified as a downloadable text transcript. Preserve the authenticated DEV-only boundary and reuse the shared formatter for CLI and browser exports.

## User-visible contract

- A reusable CLI exports one conversation by ChatID in chronological order.
- The transcript includes ChatID, date, condition, `promptId`, `promptVersion`, and `interviewerModel`.
- Every developer chat page exposes an export control in the right-hand reference panel.
- The control is disabled before session creation and becomes a download link afterward.
- The browser export is a readable `.txt` attachment with a safe filename containing the Pacific timestamp and full ChatID.
- Production participant chat behavior remains unchanged.

## Implemented working-tree changes

These changes are currently uncommitted and must be reviewed rather than overwritten:

- `scripts/export-conversation.ts`
- `scripts/export-conversation.md`
- `lib/transcript.ts`
- `app/api/dev/sessions/[chatId]/export/route.ts`
- `app/dev/chat/dev-chat-shell.tsx`
- `app/dev/chat/page.tsx`
- `app/chat/chat-client.tsx`
- `package.json`
- `pnpm-lock.yaml`
- `.md/COMMANDS.md`

The earlier PDF implementation and its `pdfmake` dependencies were removed when the requested browser format was clarified as a text file. `Failed logs/` and generated `transcripts/` output also exist locally; treat transcript output as private study data.

## Verification ledger

### Verified

- CLI validation behavior: missing ChatID and invalid UUID retain their expected error/exit behavior.
- CLI database export: `corepack pnpm db:export-conversation 016c9d61-b9ff-43df-b0b6-2040c5ddddd1` completed in the prior session and wrote `transcript.md` under a Pacific-timestamped, full-ChatID folder.
- Shared formatter: prior smoke coverage confirmed Pacific filename generation, hidden-seed omission, visible user/assistant content, and Markdown table escaping.
- Browser authorization: a participant session scoped to an existing DEV chat received HTTP 200; removing that participant cookie received HTTP 401 with `unauthorized`.
- Browser response: `Content-Type` was exactly `text/plain; charset=utf-8`; `Content-Disposition` was a `.txt` attachment containing the safe Pacific timestamp and full ChatID.
- Browser transcript: response text contained the export heading, ChatID, DEV condition, prompt ID/version, interviewer model, and conversation messages; the hidden seed instruction was absent.
- Developer UI transition: the right-panel export control was disabled before session creation, then became an enabled `Export text transcript` link targeting the newly created DEV chat after the session POST returned HTTP 200.
- Verification cleanup: the DEV session and related rows created by the UI transition check were deleted; the original `.env.local` contents were restored exactly and temporary cookies/helpers were removed.
- Focused Biome formatting/check covered the export route, developer shell/page, participant chat client, shared formatter, and CLI exporter.
- Command catalog: `.md/COMMANDS.md` records link creation, Supabase exports, transcript exports, diagnostics, verification, schema operations, credential operations, and destructive-command warnings.

### Local verification setup note

The repository’s local `AUTH_SECRET` is absent, so the browser check used an ephemeral local NextAuth token. The `POSTGRES_URL` contains a dollar sign that Next’s dotenv expansion otherwise changes; verification temporarily escaped it, restored `.env.local` byte-for-byte afterward, and never printed the value. This is a local test-environment issue, not an export-route failure.

## Exact next action

No implementation work remains for the requested text export. Before commit or deployment, review the full uncommitted working tree because it contains work from multiple sessions and private generated output directories that must not be committed.

## Authorization boundary

Cursor restoration is cancelled. The saved Cursor OAuth credential is expired and refresh returns `Invalid User API Key`; the account belongs to the user's friend. Do not attempt Cursor login, token recovery, credential replacement, or another refresh. Resume only after the account owner explicitly reauthorizes through Cursor.

Google Antigravity desktop and OMP provider access are not considered fully restored until the user-facing path that failed is verified: switching the live OMP session to the requested Antigravity model and sending a normal prompt such as `say hi`. Prior isolated CLI checks and quota reports are only supporting evidence.

## Model availability check

On 2026-09-14, OMP was updated from 16.3.11 to 18.1.21 and isolated calls to `google-antigravity/claude-opus-4-6` succeeded. The user later reproduced the original failure in the live session-only model path with both `google-antigravity/claude-opus-4-6` and `google-antigravity/gemini-3.1-flash-lite`, returning HTTP 429 `RESOURCE_EXHAUSTED` and the 1800000ms retry delay. Do not claim Antigravity is fixed until that live session model-switch path passes.

Follow-up diagnosis: the failing live TUI process is PID 2560 and has been running since before `omp update --force` reported `Restart omp to use the new version`. After clearing stale `google-antigravity:oauth` credential-block rows, a fresh OMP 18.1.21 process resumed the exact same session `01a094a2-44f7-7000-a620-29686842048f` with `google-antigravity/claude-opus-4-6` and reached `stopReason: "stop"` with text output. Current conclusion: the remaining failure is the stale live OMP process, not the Antigravity credential or quota. Required user-facing verification is still to exit the old OMP TUI, reopen/resume the session, switch to `google-antigravity/claude-opus-4-6`, and send `say hi`.
