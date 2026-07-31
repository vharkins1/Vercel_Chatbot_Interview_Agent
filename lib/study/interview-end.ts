// End-of-interview detection for the participant path.
//
// The interviewer's wording lives in an OpenAI Stored Prompt outside this
// repo, so we do not try to recognize arbitrary closing prose. Instead the
// question list handed to the prompt ends with one fixed, non-randomized
// closing question (see CLOSING_QUESTION_TEXT and the FINAL block built by
// lib/interview/select-questions.ts). It is identical for conditions A, B and
// C and is always last, so the interviewer emitting it is the hallmark that
// the interview is over. Detection is a normalized substring match on a core
// fragment of that sentence.

/** The 16th and final interview question. Identical across A/B/C, never
 *  shuffled. The participant-facing survey URL is appended server-side to the
 *  message that contains it, so this text deliberately ends at the colon. */
export const CLOSING_QUESTION_TEXT =
  "Please continue to take the Qualtrics survey at this link:";

/** Core fragment matched against the interviewer's reply, normalized. Kept
 *  shorter than the full sentence so trailing punctuation, markdown emphasis,
 *  or a reworded lead-in ("Great — please continue to take…") still match. */
const CLOSING_MATCH_FRAGMENT = "continue to take the qualtrics survey";

/** Lowercase and collapse every run of non-alphanumeric characters to a single
 *  space, so "**Please continue to take the Qualtrics survey at this link:**"
 *  and "please continue to take the qualtrics survey" normalize alike. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function looksLikeEnd(text: string): boolean {
  return normalize(text).includes(CLOSING_MATCH_FRAGMENT);
}

/** Number of interviewer replies (i.e. OpenAI calls, not participant+
 *  interviewer exchanges) after which the interview should already have
 *  reached the closing question. Past this point the chat UI reveals a subtle
 *  fallback link to the survey so a looping interviewer cannot strand anyone. */
export const SURVEY_UNLOCK_AFTER_LLM_TURNS = 20;

/** Hard stop: force the session closed even if the closing question never
 *  arrives. Counted the same way as SURVEY_UNLOCK_AFTER_LLM_TURNS. */
export const MAX_PARTICIPANT_TURNS = 25;
