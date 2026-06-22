import type { AgentSession } from "@/lib/db/schema";

/**
 * Partner-facing shape of an AgentSession.
 *
 * Strips BOTH the unblinded study-arm name `conditionLabel`
 * (positive / neutral / disconfirmatory) AND the blinded `condition` (A/B/C).
 * Both are staff-only and must never cross the agent API — no subject (human
 * or partner agent) may see the condition in any form, because any visibility
 * could bias an LLM subject. They remain stored server-side and are used only
 * to pick the prompt and write DB columns.
 *
 * Every agent endpoint that serializes an AgentSession MUST route it through
 * `toAgentSessionDTO` so neither field can leak back to the interviewee agent.
 * See `lib/study/conditions.ts` (CONDITION_LABEL) and CLAUDE.md.
 */
export type AgentSessionDTO = Omit<
  AgentSession,
  "conditionLabel" | "condition"
>;

export function toAgentSessionDTO<T extends AgentSession | null | undefined>(
  session: T
): T extends AgentSession ? AgentSessionDTO : T {
  if (!session) {
    return session as T extends AgentSession ? AgentSessionDTO : T;
  }
  const {
    conditionLabel: _conditionLabel,
    condition: _condition,
    ...dto
  } = session;
  return dto as T extends AgentSession ? AgentSessionDTO : T;
}
