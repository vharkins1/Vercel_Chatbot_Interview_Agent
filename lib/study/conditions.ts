export type Condition = "positive" | "neutral" | "negative";

export const ALL_CONDITIONS: readonly Condition[] = [
  "positive",
  "neutral",
  "negative",
] as const;

export function isCondition(value: unknown): value is Condition {
  return (
    typeof value === "string" &&
    (ALL_CONDITIONS as readonly string[]).includes(value)
  );
}

type PromptRef = { promptId: string; version: string };

function readPromptRef(condition: Condition): PromptRef {
  const idEnv = `OPENAI_${condition.toUpperCase()}_PROMPT_ID`;
  const versionEnv = `OPENAI_${condition.toUpperCase()}_PROMPT_VERSION`;
  const promptId = process.env[idEnv];
  if (!promptId) {
    throw new Error(`${idEnv} is not set`);
  }
  return { promptId, version: process.env[versionEnv] ?? "1" };
}

export function promptForCondition(condition: Condition): PromptRef {
  return readPromptRef(condition);
}
