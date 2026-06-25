import { and, eq, gte, or, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  budgetPolicies,
  costEvents,
  scheduledJobs,
  users,
} from "@thinkwork/database-pg/schema";
import {
  budgetMinimumReconciliationStateFromEnv,
  mapConfidenceBreakdown,
  type BudgetMinimumReconciliationState,
} from "./cost-confidence.js";

const db = getDb();

export type UserBudgetState =
  | "no_user"
  | "unowned_user"
  | "no_policy"
  | "normal"
  | "warning"
  | "exceeded";

export interface UserBudgetCheckResult {
  tenantId: string;
  userId: string | null;
  state: UserBudgetState;
  policyId: string | null;
  limitUsd: number;
  spentUsd: number;
  visibleSpendUsd: number;
  remainingUsd: number;
  percentUsed: number;
  overBudget: boolean;
  minimumReconciliationState: BudgetMinimumReconciliationState;
  estimatedUsd: number;
  invocationReconciledUsd: number;
  billReconciledUsd: number;
  mismatchUsd: number;
  unreconciledUsd: number;
}

export interface UserBudgetPauseResult {
  tenantId: string;
  userId: string | null;
  state: UserBudgetState;
  policyId: string | null;
  limitUsd: number;
  spentUsd: number;
  visibleSpendUsd: number;
  remainingUsd: number;
  percentUsed: number;
  overBudget: boolean;
  minimumReconciliationState: BudgetMinimumReconciliationState;
  estimatedUsd: number;
  invocationReconciledUsd: number;
  billReconciledUsd: number;
  mismatchUsd: number;
  unreconciledUsd: number;
  pausedScheduledJobCount: number;
  pauseReason: string | null;
}

export interface ScheduledJobOwnerRow {
  created_by_type?: string | null;
  created_by_id?: string | null;
  config?: unknown;
}

type DbClient = typeof db;

const DEFAULT_USER_BUDGET_MINIMUM_RECONCILIATION_STATE =
  budgetMinimumReconciliationStateFromEnv();

function getStartOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function toNormalState(
  tenantId: string,
  userId: string | null,
  state: UserBudgetState,
): UserBudgetCheckResult {
  return {
    tenantId,
    userId,
    state,
    policyId: null,
    limitUsd: 0,
    spentUsd: 0,
    visibleSpendUsd: 0,
    remainingUsd: 0,
    percentUsed: 0,
    overBudget: false,
    minimumReconciliationState:
      DEFAULT_USER_BUDGET_MINIMUM_RECONCILIATION_STATE,
    estimatedUsd: 0,
    invocationReconciledUsd: 0,
    billReconciledUsd: 0,
    mismatchUsd: 0,
    unreconciledUsd: 0,
  };
}

function toStatus(percentUsed: number): UserBudgetState {
  if (percentUsed >= 100) return "exceeded";
  if (percentUsed >= 80) return "warning";
  return "normal";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveScheduledJobCostOwner(
  row: ScheduledJobOwnerRow,
): string | null {
  const config = asObject(row.config);
  const invokerUserId = config.invokerUserId;
  if (typeof invokerUserId === "string" && invokerUserId.trim()) {
    return invokerUserId;
  }

  if (row.created_by_type === "user" && row.created_by_id) {
    return row.created_by_id;
  }

  return null;
}

export async function resolveTenantUserCostOwner(args: {
  tenantId: string;
  userId?: string | null;
  db?: DbClient;
}): Promise<string | null> {
  const userId = args.userId ?? null;
  if (!userId) return null;

  const database = args.db ?? db;
  let user: { id: string } | undefined;
  try {
    [user] = await database
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenant_id, args.tenantId)))
      .limit(1);
  } catch (err) {
    console.warn(
      `[cost] user attribution lookup failed tenant=${args.tenantId} user=${userId}:`,
      err,
    );
    return null;
  }

  return user ? userId : null;
}

export async function getUserBudgetStatus(args: {
  tenantId: string;
  userId?: string | null;
  db?: DbClient;
  monthStart?: Date;
  minimumReconciliationState?: BudgetMinimumReconciliationState;
}): Promise<UserBudgetCheckResult> {
  const database = args.db ?? db;
  const userId = args.userId ?? null;
  if (!userId) return toNormalState(args.tenantId, null, "no_user");

  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, args.tenantId)))
    .limit(1);

  if (!user) return toNormalState(args.tenantId, userId, "unowned_user");

  const [policy] = await database
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.tenant_id, args.tenantId),
        eq(budgetPolicies.scope, "user"),
        eq(budgetPolicies.user_id, userId),
        eq(budgetPolicies.enabled, true),
      ),
    )
    .limit(1);

  if (!policy) return toNormalState(args.tenantId, userId, "no_policy");

  const [spend] = await database
    .select({
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, args.tenantId),
        eq(costEvents.user_id, userId),
        gte(costEvents.created_at, args.monthStart ?? getStartOfMonth()),
      ),
    );

  const limitUsd = Number(policy.limit_usd);
  const minimumReconciliationState =
    args.minimumReconciliationState ??
    DEFAULT_USER_BUDGET_MINIMUM_RECONCILIATION_STATE;
  const legacyTotal = (spend as { total?: unknown } | undefined)?.total;
  const confidence = mapConfidenceBreakdown(
    {
      totalUsd: spend?.totalUsd ?? legacyTotal,
      enforcedUsd: legacyTotal,
      estimatedUsd: spend?.estimatedUsd,
      invocationReconciledUsd: spend?.invocationReconciledUsd,
      billReconciledUsd: spend?.billReconciledUsd,
      mismatchUsd: spend?.mismatchUsd,
      unreconciledUsd: spend?.unreconciledUsd,
    },
    minimumReconciliationState,
  );
  const spentUsd = confidence.enforcedUsd;
  const remainingUsd = Math.max(0, limitUsd - spentUsd);
  const percentUsed = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;
  const state = toStatus(percentUsed);

  return {
    tenantId: args.tenantId,
    userId,
    state,
    policyId: policy.id,
    limitUsd,
    spentUsd,
    visibleSpendUsd: confidence.totalUsd,
    remainingUsd,
    percentUsed,
    overBudget: state === "exceeded",
    minimumReconciliationState,
    estimatedUsd: confidence.estimatedUsd,
    invocationReconciledUsd: confidence.invocationReconciledUsd,
    billReconciledUsd: confidence.billReconciledUsd,
    mismatchUsd: confidence.mismatchUsd,
    unreconciledUsd: confidence.unreconciledUsd,
  };
}

export async function pauseUserOwnedScheduledWorkForBudget(args: {
  tenantId: string;
  userId: string;
  reason: string;
  db?: DbClient;
  now?: Date;
}): Promise<{ pausedScheduledJobCount: number }> {
  const database = args.db ?? db;
  const now = args.now ?? new Date();
  const rows = await database
    .update(scheduledJobs)
    .set({
      budget_paused: true,
      budget_paused_at: now,
      budget_paused_reason: args.reason,
      updated_at: now,
    })
    .where(
      and(
        eq(scheduledJobs.tenant_id, args.tenantId),
        eq(scheduledJobs.enabled, true),
        eq(scheduledJobs.budget_paused, false),
        or(
          and(
            eq(scheduledJobs.created_by_type, "user"),
            eq(scheduledJobs.created_by_id, args.userId),
          ),
          sql`${scheduledJobs.config}->>'invokerUserId' = ${args.userId}`,
        ),
      ),
    )
    .returning({ id: scheduledJobs.id });

  return { pausedScheduledJobCount: rows.length };
}

export async function checkUserBudgetAndPauseWork(args: {
  tenantId: string;
  userId?: string | null;
  db?: DbClient;
  monthStart?: Date;
  now?: Date;
}): Promise<UserBudgetPauseResult> {
  const status = await getUserBudgetStatus(args);
  if (!status.overBudget || !status.userId) {
    return {
      ...status,
      pausedScheduledJobCount: 0,
      pauseReason: null,
    };
  }

  const pauseReason = `User budget exceeded: $${status.spentUsd.toFixed(2)} >= $${status.limitUsd.toFixed(2)}`;
  const pause = await pauseUserOwnedScheduledWorkForBudget({
    tenantId: args.tenantId,
    userId: status.userId,
    reason: pauseReason,
    db: args.db,
    now: args.now,
  });

  return {
    ...status,
    pausedScheduledJobCount: pause.pausedScheduledJobCount,
    pauseReason,
  };
}
