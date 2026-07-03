/**
 * Thread Mode derivation (plan 2026-07-03-003 U3, R1/R2/R3).
 *
 * Server-authoritative Thread Mode: whether a thread behaves as an Agent thread
 * (messages auto-dispatch) or a Multiplayer thread (agent must be mentioned or
 * explicitly requested). Derived from the count of human (participant_type
 * 'user') participants, with an explicit per-thread override that wins.
 *
 *   - override present ('agent' | 'multiplayer') → the override, always.
 *   - 0 or 1 human participants → 'agent'.
 *   - 2 or more human participants → 'multiplayer'.
 *
 * Pure and dependency-free so both the GraphQL `Thread.mode` resolver and the
 * dispatch gate (U4) can share one definition. Mirrors the web-side
 * `deriveAgentMode` heuristic (apps/web/src/lib/agent-mode.ts) but from server
 * truth rather than client inference.
 */

export type ThreadMode = "agent" | "multiplayer";

export function deriveThreadMode(
  humanParticipantCount: number,
  override: ThreadMode | null | undefined,
): ThreadMode {
  if (override === "agent" || override === "multiplayer") return override;
  return humanParticipantCount >= 2 ? "multiplayer" : "agent";
}
