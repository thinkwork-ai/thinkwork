export type CostReconciliationState =
  | "runtime-reported"
  | "invocation-reconciled"
  | "bill-reconciled"
  | "mismatch"
  | "unreconciled/error";

export type BudgetMinimumReconciliationState =
  | "runtime-reported"
  | "invocation-reconciled"
  | "bill-reconciled";

export interface CostConfidenceBreakdown {
  totalUsd: number;
  enforcedUsd: number;
  estimatedUsd: number;
  invocationReconciledUsd: number;
  billReconciledUsd: number;
  mismatchUsd: number;
  unreconciledUsd: number;
  minimumReconciliationState: BudgetMinimumReconciliationState;
}

type CostConfidenceRow = Partial<
  Record<
    Exclude<keyof CostConfidenceBreakdown, "minimumReconciliationState">,
    unknown
  >
>;

const ORDER: Record<BudgetMinimumReconciliationState, number> = {
  "runtime-reported": 0,
  "invocation-reconciled": 1,
  "bill-reconciled": 2,
};

export const DEFAULT_BUDGET_MINIMUM_RECONCILIATION_STATE: BudgetMinimumReconciliationState =
  "bill-reconciled";

export function normalizeBudgetMinimumReconciliationState(
  value: unknown,
): BudgetMinimumReconciliationState {
  if (
    value === "runtime-reported" ||
    value === "invocation-reconciled" ||
    value === "bill-reconciled"
  ) {
    return value;
  }
  return DEFAULT_BUDGET_MINIMUM_RECONCILIATION_STATE;
}

export function budgetMinimumReconciliationStateFromEnv(
  env: Record<string, string | undefined> = process.env,
): BudgetMinimumReconciliationState {
  return normalizeBudgetMinimumReconciliationState(
    env.USER_BUDGET_MIN_RECONCILIATION_STATE ??
      env.BUDGET_MIN_RECONCILIATION_STATE,
  );
}

export function isCostStateEnforced(
  state: string | null | undefined,
  minimum: BudgetMinimumReconciliationState,
): boolean {
  if (
    state !== "runtime-reported" &&
    state !== "invocation-reconciled" &&
    state !== "bill-reconciled"
  ) {
    return false;
  }
  return ORDER[state] >= ORDER[minimum];
}

export function mapConfidenceBreakdown(
  row: CostConfidenceRow,
  minimumReconciliationState: BudgetMinimumReconciliationState,
): CostConfidenceBreakdown {
  const estimatedUsd = toNumber(row.estimatedUsd);
  const invocationReconciledUsd = toNumber(row.invocationReconciledUsd);
  const billReconciledUsd = toNumber(row.billReconciledUsd);

  return {
    totalUsd: toNumber(row.totalUsd),
    enforcedUsd:
      row.enforcedUsd === undefined
        ? computeEnforcedUsd(
            {
              estimatedUsd,
              invocationReconciledUsd,
              billReconciledUsd,
            },
            minimumReconciliationState,
          )
        : toNumber(row.enforcedUsd),
    estimatedUsd,
    invocationReconciledUsd,
    billReconciledUsd,
    mismatchUsd: toNumber(row.mismatchUsd),
    unreconciledUsd: toNumber(row.unreconciledUsd),
    minimumReconciliationState,
  };
}

function computeEnforcedUsd(
  row: Pick<
    CostConfidenceBreakdown,
    "estimatedUsd" | "invocationReconciledUsd" | "billReconciledUsd"
  >,
  minimumReconciliationState: BudgetMinimumReconciliationState,
): number {
  if (minimumReconciliationState === "runtime-reported") {
    return (
      row.estimatedUsd + row.invocationReconciledUsd + row.billReconciledUsd
    );
  }
  if (minimumReconciliationState === "invocation-reconciled") {
    return row.invocationReconciledUsd + row.billReconciledUsd;
  }
  return row.billReconciledUsd;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
