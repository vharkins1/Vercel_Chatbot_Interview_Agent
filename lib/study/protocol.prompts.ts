/**
 * Study Protocol Prompts Loader — Server Only
 *
 * Reads all prompt templates and question data from the plain-text
 * files in the prompts/ folder. This file uses Node's fs module
 * and must only be imported in server-side code (API routes).
 *
 * To customize prompts, edit the .txt and .json files in prompts/.
 * See prompts/README.txt for instructions.
 */

import { readFileSync } from "fs";
import { join } from "path";

const PROMPTS_DIR = join(process.cwd(), "lib", "study", "prompts");

function loadText(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), "utf-8").trim();
}

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(PROMPTS_DIR, filename), "utf-8"));
}

// ── Topics & Questions (from JSON files) ─────────────────────

export const TOPICS_FROM_FILE: Array<{ name: string; introduction: string }> =
  loadJson("topics.json");

export const QUESTIONS: Array<{
  topicName: string;
  intimacy: "low" | "moderate" | "high";
  text: string;
}> = loadJson<Array<{ topic: string; intimacy: "low" | "moderate" | "high"; text: string }>>(
  "questions.json"
).map((q) => ({
  topicName: q.topic,
  intimacy: q.intimacy,
  text: q.text,
}));

// ── Prompt Templates (from text files) ───────────────────────

export const CONSENT_MESSAGE = loadText("consent-message.txt");

export const FEEDBACK_TEMPLATES: Record<string, string> = {
  positive: loadText("feedback-positive.txt"),
  negative: loadText("feedback-negative.txt"),
  neutral: loadText("feedback-neutral.txt"),
};

export const QUESTIONING_TEMPLATE = loadText("questioning.txt");

export const TOPIC_TRANSITION_TEMPLATE = loadText("topic-transition.txt");

export const CONSENT_TEMPLATE = loadText("consent-instructions.txt");

export const COMPLETION_TEMPLATE = loadText("completion.txt");

export const SUMMARIZATION_TEMPLATE = loadText("summarization.txt");
