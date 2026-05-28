import type { AgentSession } from "@/lib/db/schema";

/**
 * Partner-facing shape of an AgentSession.
 *
 * Strips `conditionLabel` — the unblinded study-arm name
 * (positive / neutral / disconfirmatory) — which is staff-only and must
 * never cross the agent API. The blinded `condition` (A/B/C) is retained.
 *
 * Every agent endpoint that serializes an AgentSession MUST route it through
 * `toAgentSessionDTO` so the label can't leak back to the interviewee agent.
 * See `lib/study/conditions.ts` (CONDITION_LABEL) and CLAUDE.md.
 */
export type AgentSessionDTO = Omit<AgentSession, "conditionLabel">;

export function toAgentSessionDTO<T extends AgentSession | null | undefined>(
  session: T
): T extends AgentSession ? AgentSessionDTO : T {
  if (!session) {
    return session as T extends AgentSession ? AgentSessionDTO : T;
  }
  const { conditionLabel: _conditionLabel, ...dto } = session;
  return dto as T extends AgentSession ? AgentSessionDTO : T;
}
