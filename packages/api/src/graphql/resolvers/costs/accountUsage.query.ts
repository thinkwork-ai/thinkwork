import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  gte,
  lte,
  sql,
  costEvents,
  users,
  modelCatalog,
  tenantModelCatalog,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  budgetMinimumReconciliationStateFromEnv,
  mapConfidenceBreakdown,
  type BudgetMinimumReconciliationState,
} from "../../../lib/cost-confidence.js";

type AccountUsageArgs = {
  tenantId: string;
  userId: string;
  days?: number | null;
};

type UsageSummaryRow = {
  totalUsd: number | string | null;
  llmUsd: number | string | null;
  computeUsd: number | string | null;
  toolsUsd: number | string | null;
  enforcedUsd: number | string | null;
  estimatedUsd: number | string | null;
  invocationReconciledUsd: number | string | null;
  billReconciledUsd: number | string | null;
  mismatchUsd: number | string | null;
  unreconciledUsd: number | string | null;
  inputTokens: number | string | null;
  outputTokens: number | string | null;
  eventCount: number | string | null;
};

type UsageModelRow = {
  model: string | null;
  tenantDisplayName: string | null;
  catalogDisplayName: string | null;
  totalUsd: number | string | null;
  enforcedUsd: number | string | null;
  estimatedUsd: number | string | null;
  invocationReconciledUsd: number | string | null;
  billReconciledUsd: number | string | null;
  mismatchUsd: number | string | null;
  unreconciledUsd: number | string | null;
  inputTokens: number | string | null;
  outputTokens: number | string | null;
};

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeDays(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_DAYS;
  }
  return Math.min(value, MAX_DAYS);
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toInt(value: number | string | null | undefined): number {
  return Math.trunc(toNumber(value));
}

function emptySummary(
  minimumReconciliationState: BudgetMinimumReconciliationState,
) {
  return {
    totalUsd: 0,
    llmUsd: 0,
    computeUsd: 0,
    toolsUsd: 0,
    enforcedUsd: 0,
    estimatedUsd: 0,
    invocationReconciledUsd: 0,
    billReconciledUsd: 0,
    mismatchUsd: 0,
    unreconciledUsd: 0,
    minimumReconciliationState,
    inputTokens: 0,
    outputTokens: 0,
    eventCount: 0,
  };
}

function mapSummary(
  row: UsageSummaryRow | undefined,
  minimumReconciliationState: BudgetMinimumReconciliationState,
) {
  if (!row) return emptySummary(minimumReconciliationState);
  const confidence = mapConfidenceBreakdown(
    {
      totalUsd: row.totalUsd,
      estimatedUsd: row.estimatedUsd,
      invocationReconciledUsd: row.invocationReconciledUsd,
      billReconciledUsd: row.billReconciledUsd,
      mismatchUsd: row.mismatchUsd,
      unreconciledUsd: row.unreconciledUsd,
    },
    minimumReconciliationState,
  );
  return {
    totalUsd: toNumber(row.totalUsd),
    llmUsd: toNumber(row.llmUsd),
    computeUsd: toNumber(row.computeUsd),
    toolsUsd: toNumber(row.toolsUsd),
    enforcedUsd: confidence.enforcedUsd,
    estimatedUsd: confidence.estimatedUsd,
    invocationReconciledUsd: confidence.invocationReconciledUsd,
    billReconciledUsd: confidence.billReconciledUsd,
    mismatchUsd: confidence.mismatchUsd,
    unreconciledUsd: confidence.unreconciledUsd,
    minimumReconciliationState,
    inputTokens: toInt(row.inputTokens),
    outputTokens: toInt(row.outputTokens),
    eventCount: toInt(row.eventCount),
  };
}

export const accountUsage = async (
  _parent: unknown,
  args: AccountUsageArgs,
  ctx: GraphQLContext,
) => {
  const caller =
    ctx.auth.authType === "cognito" ? await resolveCaller(ctx) : null;
  const isSelf = caller?.userId === args.userId;
  if (!isSelf) {
    await requireAdminOrServiceCaller(ctx, args.tenantId, "account_usage:read");
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, args.userId), eq(users.tenant_id, args.tenantId)))
    .limit(1);
  if (!user) {
    throw new Error("User not found in tenant");
  }

  const days = normalizeDays(args.days);
  const minimumReconciliationState = budgetMinimumReconciliationStateFromEnv();
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * DAY_MS);
  const scopedUsage = and(
    eq(costEvents.tenant_id, args.tenantId),
    eq(costEvents.user_id, args.userId),
    gte(costEvents.created_at, periodStart),
    lte(costEvents.created_at, periodEnd),
  );

  const [summaryRow] = await db
    .select({
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      llmUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'llm' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      computeUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'agentcore_compute' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      toolsUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} NOT IN ('llm', 'agentcore_compute', 'eval') THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      inputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
      eventCount: sql<number>`COUNT(*)::int`,
    })
    .from(costEvents)
    .where(scopedUsage);

  const dayBucket = sql`(date_trunc('day', ${costEvents.created_at}))::date`;
  const dailyRows = await db
    .select({
      day: sql<string>`${dayBucket}::text`,
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      llmUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'llm' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      computeUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} = 'agentcore_compute' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      toolsUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.event_type} NOT IN ('llm', 'agentcore_compute', 'eval') THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      inputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
      eventCount: sql<number>`COUNT(*)::int`,
    })
    .from(costEvents)
    .where(scopedUsage)
    .groupBy(dayBucket)
    .orderBy(dayBucket);

  const modelRows = await db
    .select({
      model: costEvents.model,
      tenantDisplayName: tenantModelCatalog.display_name,
      catalogDisplayName: modelCatalog.display_name,
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      estimatedUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'runtime-reported' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      invocationReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'invocation-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      billReconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'bill-reconciled' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      mismatchUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'mismatch' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      unreconciledUsd: sql<number>`COALESCE(SUM(CASE WHEN ${costEvents.reconciliation_state} = 'unreconciled/error' THEN ${costEvents.amount_usd} ELSE 0 END), 0)::float`,
      inputTokens: sql<number>`COALESCE(SUM(${costEvents.input_tokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${costEvents.output_tokens}), 0)::int`,
    })
    .from(costEvents)
    .leftJoin(
      tenantModelCatalog,
      and(
        eq(tenantModelCatalog.tenant_id, args.tenantId),
        eq(tenantModelCatalog.model_id, costEvents.model),
      ),
    )
    .leftJoin(modelCatalog, eq(modelCatalog.model_id, costEvents.model))
    .where(and(scopedUsage, eq(costEvents.event_type, "llm")))
    .groupBy(
      costEvents.model,
      tenantModelCatalog.display_name,
      modelCatalog.display_name,
    );

  const summary = mapSummary(
    summaryRow as UsageSummaryRow | undefined,
    minimumReconciliationState,
  );
  const llmUsd = summary.llmUsd;

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    summary,
    daily: (dailyRows as Array<UsageSummaryRow & { day: string }>).map(
      (row) => ({
        day: row.day,
        ...mapSummary(row, minimumReconciliationState),
      }),
    ),
    models: (modelRows as UsageModelRow[])
      .map((row) => {
        const model = row.model || "unknown";
        const totalUsd = toNumber(row.totalUsd);
        const confidence = mapConfidenceBreakdown(
          {
            totalUsd: row.totalUsd,
            estimatedUsd: row.estimatedUsd,
            invocationReconciledUsd: row.invocationReconciledUsd,
            billReconciledUsd: row.billReconciledUsd,
            mismatchUsd: row.mismatchUsd,
            unreconciledUsd: row.unreconciledUsd,
          },
          minimumReconciliationState,
        );
        return {
          model,
          displayName: row.tenantDisplayName || row.catalogDisplayName || model,
          totalUsd,
          enforcedUsd: confidence.enforcedUsd,
          estimatedUsd: confidence.estimatedUsd,
          invocationReconciledUsd: confidence.invocationReconciledUsd,
          billReconciledUsd: confidence.billReconciledUsd,
          mismatchUsd: confidence.mismatchUsd,
          unreconciledUsd: confidence.unreconciledUsd,
          minimumReconciliationState,
          inputTokens: toInt(row.inputTokens),
          outputTokens: toInt(row.outputTokens),
          usageShare: llmUsd > 0 ? totalUsd / llmUsd : 0,
        };
      })
      .sort((a, b) => b.totalUsd - a.totalUsd),
  };
};
