import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { runtimePrompt } from "@/lib/db/schema";

export const RUNTIME_PROMPT_KEYS = {
  closingQuestion: "closing_question",
  interviewStart: "interview_start",
} as const;

export type RuntimePromptKey =
  (typeof RUNTIME_PROMPT_KEYS)[keyof typeof RUNTIME_PROMPT_KEYS];

export async function getRuntimePrompt(key: RuntimePromptKey): Promise<string> {
  const [row] = await db
    .select({ content: runtimePrompt.content })
    .from(runtimePrompt)
    .where(eq(runtimePrompt.key, key))
    .limit(1);

  const content = row?.content.trim();
  if (!content) {
    throw new Error(`Missing private runtime prompt: ${key}`);
  }
  return content;
}
