# Conversation Export Instructions

Use the reusable exporter from the project root:

```bash
pnpm db:export-conversation <ChatID>
```

If `pnpm` is unavailable in the current shell, run:

```bash
./node_modules/.bin/tsx scripts/export-conversation.ts <ChatID>
```

## Required behavior

1. Read the Supabase Postgres connection from `POSTGRES_URL` in `.env.local`.
2. Require a valid UUID ChatID and export only that conversation.
3. Include ChatID, date, condition, `promptId`, `promptVersion`, and `interviewerModel` in the metadata table.
4. Order messages chronologically by `Message_v2.createdAt`, with message ID as the deterministic tie-breaker.
5. Display the conversation date and every message timestamp in Pacific time using the `America/Los_Angeles` time zone. This automatically uses PST or PDT according to the date.
6. Create one conversation folder under `transcripts/`, named with the Pacific timestamp followed by the full ChatID:

   ```text
   YYYY-MM-DD_HH-MM-SS_PST-or-PDT_<ChatID>/
   ```

7. Write the readable transcript to `transcript.md` inside that folder.
8. Open `transcript.md` automatically after the export completes.

Example output path:

```text
transcripts/2026-09-11_19-08-05_PDT_d22b3cc9-d491-4da3-bfa4-3dbab81f79d7/transcript.md
```

The `transcripts/` directory is gitignored because transcript content and condition metadata are private study data.
