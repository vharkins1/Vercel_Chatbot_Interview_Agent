/**
 * Study Protocol Prompts Loader — Server Only
 *
 * Imports prompt content from prompts/generated.ts — a build artifact
 * produced by scripts/generate-prompts.ts that inlines every .txt/.json
 * file under prompts/ as a regular JS module. This avoids runtime
 * readFileSync and Next.js file-tracing altogether.
 *
 * To customize prompts: edit the .txt/.json files in prompts/, run
 * `pnpm gen:prompts` (auto-runs on `pnpm dev` and `pnpm build`),
 * commit, and push. See prompts/README.md for details.
 */

import { JSON_FILES, TEXT_FILES } from "./prompts/generated";

// ── Types ────────────────────────────────────────────────────

type PromptData = {
  questions: Array<{
    topicName: string;
    intimacy: "low" | "moderate" | "high";
    text: string;
  }>;
  consentMessage: string;
  feedbackTemplates: Record<string, string>;
  questioningTemplates: Record<string, string>;
  topicTransitionTemplates: Record<string, string>;
  consentTemplate: string;
  completionTemplate: string;
  summarizationTemplate: string;
  reaskTemplate: string;
  moveOnTemplate: string;
  answerJudgeTemplate: string;
  answerJudgeUserTemplate: string;
};

// ── Cache ────────────────────────────────────────────────────

let cachedPrompts: PromptData | null = null;

function text(name: string): string {
  const value = TEXT_FILES[name];
  if (value === undefined) {
    throw new Error(`Missing prompt file in generated bundle: ${name}`);
  }
  return value;
}

function jsonValue<T>(name: string): T {
  const value = JSON_FILES[name];
  if (value === undefined) {
    throw new Error(`Missing JSON file in generated bundle: ${name}`);
  }
  return value as T;
}

function buildPromptData(): PromptData {
  const rawQuestions = jsonValue<Array<{
    topic: string;
    intimacy: "low" | "moderate" | "high";
    text: string;
  }>>("questions.json");

  return {
    questions: rawQuestions.map((q) => ({
      topicName: q.topic,
      intimacy: q.intimacy,
      text: q.text,
    })),
    consentMessage: text("consent-message.txt"),
    feedbackTemplates: {
      positive: text("feedback-positive.txt"),
      negative: text("feedback-negative.txt"),
      neutral: text("feedback-neutral.txt"),
    },
    questioningTemplates: {
      positive: text("questioning-positive.txt"),
      negative: text("questioning-negative.txt"),
      neutral: text("questioning-neutral.txt"),
    },
    topicTransitionTemplates: {
      positive: text("topic-transition-positive.txt"),
      negative: text("topic-transition-negative.txt"),
      neutral: text("topic-transition-neutral.txt"),
    },
    consentTemplate: text("consent-instructions.txt"),
    completionTemplate: text("completion.txt"),
    summarizationTemplate: text("summarization.txt"),
    reaskTemplate: text("reask.txt"),
    moveOnTemplate: text("move-on.txt"),
    answerJudgeTemplate: text("answer-judge.txt"),
    answerJudgeUserTemplate: text("answer-judge-user.txt"),
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Load all prompt data from the bundled module. Cached after first call.
 */
export async function getPrompts(): Promise<PromptData> {
  if (cachedPrompts) return cachedPrompts;
  cachedPrompts = buildPromptData();
  return cachedPrompts;
}
