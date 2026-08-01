import "server-only";

// Single source of truth for the human-facing Qualtrics follow-up link. Two
// call sites need identical URLs: the turns route (which appends the link to
// the interviewer's closing message) and the /complete route (which backs the
// "continue to survey" button). Keep them here so they cannot drift.

// The live survey. Unset means no link: callers must treat null as "no
// handoff available" rather than substituting a placeholder, so a
// misconfigured deployment fails visibly instead of sending participants to a
// dead URL.
function followupBase(): string | null {
  return process.env.QUALTRICS_FOLLOWUP_URL ?? null;
}

/**
 * Carry the study join keys onto the Qualtrics follow-up link so the human's
 * browser-side survey captures them as embedded data (Qualtrics auto-captures
 * matching URL query params when the fields are declared in the Survey Flow —
 * declare completion_code, chat_id and participant_seq there or Qualtrics
 * silently drops them; scripts/ensure-survey-fields.ts automates the
 * declaration). Mirrors the agent path, which injects the same three keys at
 * submit (see app/api/agent/v1/.../survey/route.ts).
 */
export function buildFollowupUrl({
  chatId,
  seq,
  completionCode,
  qualtricsResponseId,
}: {
  chatId: string;
  seq: number | null;
  completionCode: string | null;
  qualtricsResponseId?: string | null;
}): string | null {
  const base = followupBase();
  if (!base) {
    return null;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("chat_id", chatId);
    if (seq != null) {
      url.searchParams.set("participant_seq", String(seq));
    }
    if (completionCode) {
      url.searchParams.set("completion_code", completionCode);
    }
    // Carried through from the pre-survey so pre, interview and post can be
    // joined on one key. Must also be declared as Embedded Data on the
    // post-survey's flow (`rid`) or Qualtrics drops it silently.
    if (qualtricsResponseId) {
      url.searchParams.set("rid", qualtricsResponseId);
    }
    return url.toString();
  } catch {
    // Non-absolute or malformed URL: leave it untouched rather than drop it.
    return base;
  }
}

/**
 * Rendered form of the link appended to the interviewer's closing message.
 * Written as an explicit markdown link whose label is the URL itself, so the
 * participant both sees the address and can click it (the message renderer
 * does not autolink bare URLs).
 */
export function formatFollowupLinkForMessage(url: string): string {
  return `\n\n[${url}](${url})`;
}
