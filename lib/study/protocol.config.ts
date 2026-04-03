/**
 * Study Protocol Configuration — Client-Safe Settings
 *
 * These are simple constants that can be used on both client and server.
 * All prompt templates and questions are loaded from the prompts/ folder
 * by protocol.prompts.ts (server-only).
 */

// ── Settings ─────────────────────────────────────────────────

/** How topics are presented: "sequential" or "random" */
export const TOPIC_ORDER: "sequential" | "random" = "sequential";

/** Number of questions per topic (must match questions.json) */
export const QUESTIONS_PER_TOPIC = 3;

/** Maximum times to re-ask an unanswered question before moving on */
export const MAX_REATTEMPTS = 2;

// ── Topics (duplicated here for client-side progress bar) ────
// If you change topic names, also update prompts/topics.json to match.

export const TOPICS = [
  {
    name: "Tastes & Interests",
    introduction: "Let's start by talking about your tastes and interests.",
  },
  {
    name: "Attitudes & Values",
    introduction: "Now let's shift to talking about your attitudes and views.",
  },
  {
    name: "Work or Studies",
    introduction: "Finally, let's discuss your work or studies.",
  },
];

export const TOTAL_TOPICS = TOPICS.length;
