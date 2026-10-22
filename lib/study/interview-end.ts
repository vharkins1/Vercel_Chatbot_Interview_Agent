import "server-only";

import {
  getRuntimePrompt,
  RUNTIME_PROMPT_KEYS,
} from "@/lib/study/runtime-prompts";

// End-of-interview wording is private study configuration. Load the closing
// question from Supabase and compare it at runtime so no participant-facing
// prompt fragment is committed to the public repository.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesClosingQuestion(
  text: string,
  closingQuestion: string
): boolean {
  const normalizedClosing = normalize(closingQuestion);
  return (
    normalizedClosing.length > 0 && normalize(text).includes(normalizedClosing)
  );
}

export async function looksLikeEnd(text: string): Promise<boolean> {
  const closingQuestion = await getRuntimePrompt(
    RUNTIME_PROMPT_KEYS.closingQuestion
  );
  return matchesClosingQuestion(text, closingQuestion);
}

/** Number of interviewer replies after which the fallback survey link appears. */
export const SURVEY_UNLOCK_AFTER_LLM_TURNS = 20;

/** Hard stop if the private closing question is not emitted. */
export const MAX_PARTICIPANT_TURNS = 25;
