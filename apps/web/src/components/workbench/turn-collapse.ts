/**
 * Superseded-turn collapse (THINK-301 U6, parent R6/Q1, plan Q3).
 *
 * A turn that was retried after a stall is linked from its successor attempt
 * via `originTurnId`. The workbench thread hides such origin turns entirely
 * so each prompt shows exactly one final answer, and a successful recovery
 * leaves no trace. Keyed on explicit linkage — never on message pairing —
 * so collapse holds even when the successor's `triggeringMessageId` is
 * missing. Operator/settings surfaces intentionally stay unfiltered.
 */

export interface CollapsibleTurnLike {
  id: string;
  originTurnId?: string | null;
}

/**
 * Remove every turn whose id appears as another turn's `originTurnId` (a
 * successor attempt exists). Chains collapse transitively — each superseded
 * link in A ← B ← C is some turn's origin, so only the last attempt
 * survives. A turn pointing at an origin not present in the list is kept.
 */
export function collapseSupersededTurns<T extends CollapsibleTurnLike>(
  turns: T[],
): T[] {
  if (turns.length === 0) return turns;
  const supersededIds = new Set<string>();
  for (const turn of turns) {
    if (turn.originTurnId) supersededIds.add(turn.originTurnId);
  }
  if (supersededIds.size === 0) return turns;
  return turns.filter((turn) => !supersededIds.has(turn.id));
}
