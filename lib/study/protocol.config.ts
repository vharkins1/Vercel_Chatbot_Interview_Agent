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
    name: "Attitudes",
    introduction: "Let's start by talking about some of your attitudes and views.",
  },
  {
    name: "Tastes",
    introduction: "Now let's talk about your personal tastes and preferences.",
  },
  {
    name: "Work or Studies",
    introduction: "Let's shift to talking about your work or studies.",
  },
  {
    name: "Personality",
    introduction: "Now I'd like to ask about your personality and emotions.",
  },
  {
    name: "Body",
    introduction: "Let's talk a bit about how you feel about your body and health.",
  },
  {
    name: "Money",
    introduction: "Finally, let's discuss your financial situation.",
  },
];

export const TOTAL_TOPICS = TOPICS.length;

/** External survey URL shown after interview completion. Set to "" to disable. */
export const EXTERNAL_SURVEY_URL = "https://example.com/survey";
