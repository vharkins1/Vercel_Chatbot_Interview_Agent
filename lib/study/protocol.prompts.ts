/**
 * Study Protocol Prompts Loader — Server Only
 *
 * Loads prompt templates and question data from Vercel Blob (production)
 * or local files (development). Results are cached after first load.
 *
 * To customize prompts:
 * - Local dev: edit the .txt and .json files in prompts/
 * - Production: run the upload script to push files to Vercel Blob
 * - See prompts/README.md for instructions.
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
};

// ── Cache ────────────────────────────────────────────────────

let cachedPrompts: PromptData | null = null;

// ── Local File Loader (development fallback) ─────────────────

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
  };
}

// ── Blob Loader (production) ─────────────────────────────────

async function loadFromBlob(): Promise<PromptData> {
  const { list } = await import("@vercel/blob");
  const prefix = "study-prompts/";

  // List all blobs with our prefix
  const { blobs } = await list({ prefix });

  // Fetch all blob contents in parallel
  const contents = new Map<string, string>();
  await Promise.all(
    blobs.map(async (blob) => {
      const filename = blob.pathname.replace(prefix, "");
      const res = await fetch(blob.url);
      contents.set(filename, (await res.text()).trim());
    }),
  );

  const text = (f: string): string => {
    const val = contents.get(f);
    if (!val) throw new Error(`Missing prompt file in Blob: ${f}`);
    return val;
  };

  const rawQuestions = JSON.parse(text("questions.json")) as Array<{
    topic: string;
    intimacy: "low" | "moderate" | "high";
    text: string;
  }>;

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
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Load all prompt data. Uses Vercel Blob in production (when
 * BLOB_READ_WRITE_TOKEN is set), otherwise reads from local files.
 * Results are cached after first call.
 */
export async function getPrompts(): Promise<PromptData> {
  if (cachedPrompts) return cachedPrompts;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cachedPrompts = await loadFromBlob();
  } else {
    cachedPrompts = loadFromFiles();
  }

  return cachedPrompts;
}
