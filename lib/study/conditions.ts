export type Condition = "A" | "B" | "C";

export const ALL_CONDITIONS: readonly Condition[] = ["A", "B", "C"] as const;

export function isCondition(value: unknown): value is Condition {
  return (
    typeof value === "string" &&
    (ALL_CONDITIONS as readonly string[]).includes(value)
  );
}

/**
 * Simple (not blocked, not adaptive) randomisation across the three arms.
 *
 * Used whenever a session arrives without a pinned condition: agent sessions
 * created with no invitation token, and every participant arriving through the
 * Qualtrics entry link. Keeping it simple random means the study can be
 * described as simple randomisation in the methods section; cell sizes will
 * drift by chance, which is expected and handled in analysis rather than by
 * balancing here.
 */
export function pickRandomCondition(): Condition {
  const index = Math.floor(Math.random() * ALL_CONDITIONS.length);
  return ALL_CONDITIONS[index];
}

/**
 * Internal-only mapping from blinded code label (A/B/C) to the study's
 * descriptive label. Used for DB writes (AgentSession.conditionLabel) and
 * never returned through any API or shown in the UI — with one deliberate
 * exception: when UNBLIND_FRONTEND=1 (staff/testing only, must be unset for
 * real participants), the participant session-creation response includes it.
 * See docs/conditions-mapping.md (gitignored) for the rationale.
 */
export const CONDITION_LABEL: Record<Condition, string> = {
  A: "positive",
  B: "neutral",
  C: "disconfirmatory",
};

export function labelForCondition(condition: Condition): string {
  return CONDITION_LABEL[condition];
}

type PromptRef = { promptId: string; version: string };

function readPromptRef(condition: Condition): PromptRef {
  const idEnv = `OPENAI_${condition}_PROMPT_ID`;
  const versionEnv = `OPENAI_${condition}_PROMPT_VERSION`;
  const promptId = process.env[idEnv];
  if (!promptId) {
    throw new Error(`${idEnv} is not set`);
  }
  return { promptId, version: process.env[versionEnv] ?? "1" };
}

export function promptForCondition(condition: Condition): PromptRef {
  return readPromptRef(condition);
}
