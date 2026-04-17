/**
 * Study Protocol Prompts Loader — Server Only
 *
 * Loads prompt templates and question data from the .txt/.json files in
 * this directory. Files are bundled with the Next.js deployment via
 * `outputFileTracingIncludes` in next.config.ts. Results are cached after
 * first load.
 *
 * To customize prompts: edit the .txt and .json files in prompts/, then
 * commit and push — Vercel will redeploy with the updated text.
 * See prompts/README.md for details.
 */

import { readFileSync } from "fs";
import { join } from "path";

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

// ── File Loader ──────────────────────────────────────────────

function loadFromFiles(): PromptData {
  const dir = join(process.cwd(), "lib", "study", "prompts");

  const text = (f: string) => readFileSync(join(dir, f), "utf-8").trim();
  const json = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf-8"));

  const rawQuestions = json<Array<{ topic: string; intimacy: "low" | "moderate" | "high"; text: string }>>("questions.json");

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
 * Load all prompt data from the bundled files. Cached after first call.
 */
export async function getPrompts(): Promise<PromptData> {
  if (cachedPrompts) return cachedPrompts;
  cachedPrompts = loadFromFiles();
  return cachedPrompts;
}
