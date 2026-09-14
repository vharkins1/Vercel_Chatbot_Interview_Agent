# GPT/OMP Working Agreement

This file is the entry point for GPT-family coding agents and OMP sessions in this repository.

## Required context

1. Read `CLAUDE.md`; it is the repository's main architecture and safety guide and applies regardless of model vendor.
2. Read `.md/HANDOFF.md` before resuming unfinished work.
3. Inspect the current working tree before editing. Existing uncommitted changes may belong to another model or the user; preserve them unless the user explicitly asks to discard them.

## Work and handoff protocol

- Record the active objective, files changed, verification evidence, blockers, and exact next action in `.md/HANDOFF.md`.
- Write facts and tool evidence, not confidence statements. Never mark a result verified unless the listed command or scenario actually ran and passed.
- Do not repeat exploration already captured in the handoff unless the repository changed or the recorded evidence is insufficient.
- Keep secrets, tokens, cookies, database URLs, participant data, and transcript contents out of Markdown handoff files.
- Before ending a session, update the handoff so a different model can continue without reconstructing the conversation.

## Authorization and dead-end rule

When a task reaches an authentication, permission, account-ownership, or user-consent boundary:

1. Make at most one non-destructive attempt to use access that is already available.
2. If authorization is absent or rejected, stop that branch immediately.
3. Tell the user exactly what access or decision is required and why.
4. Wait for a definitive answer; do not retry, open repeated login flows, search for replacement credentials, or attempt to bypass the boundary.
5. Never authenticate as, recover, or use another person's account without that account owner completing the provider's authorization flow.

A different diagnostic method is appropriate only when it can distinguish a technical failure without making another authorization attempt.

## Verification standard

For every behavioral change, capture in `.md/HANDOFF.md`:

- the behavior or acceptance criterion;
- the exact focused command or browser scenario used;
- pass/fail status;
- the relevant failure message when it fails;
- the smallest concrete next step.

Do not say an issue is fixed until the product path that failed for the user has been exercised and passed. CLI smoke tests, isolated helper calls, usage/quota reports, and unit checks are supporting evidence only; they do not replace testing the actual UI/session/API flow the user reported.

After taking actions, summarize what happened, what changed, what was verified, what remains unverified or failed, and the exact next action. The summary must distinguish observed facts from conclusions.

Prefer one focused verification cycle over repeated speculative retries. If the same failure occurs twice without new evidence, stop, summarize, and ask for the missing input or authorization.
