export const traceReconciliationStates = [
  "runtime-reported",
  "invocation-reconciled",
  "bill-reconciled",
  "mismatch",
  "unreconciled/error",
] as const;

export type TraceReconciliationState =
  (typeof traceReconciliationStates)[number];

export const traceReconciliationScopes = [
  "runtime",
  "invocation",
  "bill",
  "aggregate",
  "operator_resolution",
] as const;

export type TraceReconciliationScope =
  (typeof traceReconciliationScopes)[number];

export interface TraceReconciliationFactInput {
  state: TraceReconciliationState;
  scope: TraceReconciliationScope;
  evidenceId?: string | null;
  reconciledAt?: Date | string | null;
}
