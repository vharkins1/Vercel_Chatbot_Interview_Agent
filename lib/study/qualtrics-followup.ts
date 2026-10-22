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
 * Carry the study join keys and SONA participant id onto the Qualtrics
 * follow-up link. Qualtrics captures matching URL query params only when the
 * fields are declared in the Survey Flow; scripts/ensure-survey-fields.ts
 * declares them. The agent path independently injects its applicable join keys
 * at submit time (see app/api/agent/v1/.../survey/route.ts).
 */
export function buildFollowupUrl({
  chatId,
  seq,
  completionCode,
  studyId,
  id,
}: {
  chatId: string;
  seq: number | null;
  completionCode: string | null;
  studyId?: string | null;
  id?: string | null;
}): string | null {
  const base = followupBase();
  if (!base) {
    return null;
  }
  try {
    const url = new URL(base);
    if (url.protocol !== "https:") {
      return null;
    }
    url.searchParams.set("chat_id", chatId);
    if (seq != null) {
      url.searchParams.set("participant_seq", String(seq));
    }
    if (completionCode) {
      url.searchParams.set("completion_code", completionCode);
    }
    // Carry both identifiers from the pre-survey into the post-survey.
    if (studyId) {
      url.searchParams.set("StudyID", studyId);
    }
    if (id) {
      url.searchParams.set("id", id);
    }
    return url.toString();
  } catch {
    return null;
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
