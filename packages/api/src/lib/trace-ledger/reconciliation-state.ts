import {
  type TraceReconciliationFactInput,
  type TraceReconciliationState,
  traceReconciliationStates,
} from "./trace-types.js";

const stateRank: Record<TraceReconciliationState, number> = {
  "unreconciled/error": 0,
  "runtime-reported": 1,
  mismatch: 2,
  "invocation-reconciled": 3,
  "bill-reconciled": 4,
};

export function isTraceReconciliationState(
  value: unknown,
): value is TraceReconciliationState {
  return (
    typeof value === "string" &&
    traceReconciliationStates.includes(value as TraceReconciliationState)
  );
}

export function deriveCurrentReconciliationState(
  facts: readonly TraceReconciliationFactInput[],
): TraceReconciliationState {
  if (facts.length === 0) return "unreconciled/error";
  let current: TraceReconciliationState = "unreconciled/error";
  for (const fact of facts) {
    if (fact.state === "mismatch") return "mismatch";
    if (stateRank[fact.state] > stateRank[current]) current = fact.state;
  }
  return current;
}

export function assertEvidenceBackedTransition(
  fact: TraceReconciliationFactInput,
): void {
  if (
    fact.state !== "runtime-reported" &&
    fact.state !== "unreconciled/error" &&
    !fact.evidenceId
  ) {
    throw new Error(
      `Reconciliation state "${fact.state}" requires source evidence`,
    );
  }
}
