import "server-only";

export type DevPromptInfo = {
  label: string;
  promptId: string | null;
  version?: string | null;
  model: string | null;
  description: string | null;
};

function promptFromEnvironment(
  condition: "A" | "B" | "C",
  label: string
): DevPromptInfo {
  return {
    label,
    promptId: process.env[`OPENAI_${condition}_PROMPT_ID`] ?? null,
    version: process.env[`OPENAI_${condition}_PROMPT_VERSION`] ?? "1",
    model: process.env.OPENAI_INTERVIEW_MODEL ?? null,
    description:
      "The full prompt is stored outside the repository and is loaded by OpenAI from the pinned Prompt ID and version.",
  };
}

export function getDevPrompts(): DevPromptInfo[] {
  return [
    promptFromEnvironment("A", "Condition A"),
    promptFromEnvironment("B", "Condition B"),
    promptFromEnvironment("C", "Condition C"),
  ];
}
