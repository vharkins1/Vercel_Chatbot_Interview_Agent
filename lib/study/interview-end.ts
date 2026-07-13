// End-of-interview detection shared by the participant turns route and the
// agent-side e2e script, so human and agent sessions recognize the same
// closing language. The interviewer's wording lives in an OpenAI Stored
// Prompt outside this repo, so detection is a phrase heuristic; if the prompt
// is ever updated to emit a fixed closing marker, match that here instead.

export const END_PHRASES = [
  "thanks for sharing",
  "thanks for participating",
  "this concludes",
  "that concludes",
  "we're done",
  "we are done",
  "that's all the questions",
  "thats all the questions",
  "no more questions",
  "end of the interview",
  "interview is complete",
  "interview is over",
  "wrap up",
  "wrapping up",
];

export function looksLikeEnd(text: string): boolean {
  const lower = text.toLowerCase();
  return END_PHRASES.some((p) => lower.includes(p));
}

// Safety cap on human sessions: with no manual end control in the UI, a
// looping interviewer must not strand a participant. Matches the cap the
// agent e2e scripts use. Tune per deployment if interviews run longer.
export const MAX_PARTICIPANT_TURNS = 25;
