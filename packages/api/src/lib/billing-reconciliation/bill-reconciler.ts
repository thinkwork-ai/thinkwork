import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  billingExportImports,
  billingExportLineItems,
  costEvents,
  traceCostReconciliationFacts,
  traceSourceEvidence,
} from "@thinkwork/database-pg/schema";
import type { NormalizedBillingLineItem } from "./aws-cur-import.js";

export type BillingReconciliationState =
  | "bill-reconciled"
  | "mismatch"
  | "unreconciled/error";

export interface CostEventForBillingReconciliation {
  id: string;
  tenantId: string;
  provider: string | null;
  serviceCode: string | null;
  operation: string | null;
  model: string | null;
  amountUsd: number;
  createdAt: string;
  reconciliationState: string | null;
}

export interface BillingLineItemForReconciliation {
  id: string;
  importId: string;
  tenantId: string | null;
  provider: string;
  serviceCode: string;
  operation: string;
  model: string;
  usageAccountId: string | null;
  usageStart: string;
  usageEnd: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountUsd: number;
  attributionLevel: string;
  attributionKey: string;
  sourceUri: string;
}

export interface BillingReconciliationDecision {
  state: BillingReconciliationState;
  reason: "within-tolerance" | "billing-variance" | "missing-bill-evidence";
  provider: string;
  serviceCode: string;
  operation: string;
  model: string;
  tenantId: string | null;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  attributionLevel: string;
  attributionKey: string;
  allocationConfidence: "exact-tenant" | "aggregate-only";
  projectedAmountUsd: number;
  billedAmountUsd: number;
  varianceUsd: number;
  toleranceUsd: number;
  sourceUri: string | null;
  usageAccountId: string | null;
  billingLineItemIds: string[];
  costEventIdsToUpdate: string[];
  previousCostEventStates: Array<{
    costEventId: string;
    reconciliationState: string | null;
  }>;
}

export interface PersistedBillingExportImport {
  importId: string;
  importedRows: number;
  errorRows: number;
}

interface ReconcileOptions {
  toleranceUsd?: number;
}

interface Group {
  key: string;
  tenantId: string | null;
  provider: string;
  serviceCode: string;
  operation: string;
  model: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
}

const DEFAULT_TOLERANCE_USD = 0.01;

export function reconcileBillingAggregates(
  costRows: CostEventForBillingReconciliation[],
  billRows: BillingLineItemForReconciliation[],
  options: ReconcileOptions = {},
): BillingReconciliationDecision[] {
  const toleranceUsd = options.toleranceUsd ?? DEFAULT_TOLERANCE_USD;
  const decisions: BillingReconciliationDecision[] = [];
  const matchedCostEventIds = new Set<string>();

  for (const billGroup of groupBillRows(billRows).values()) {
    const candidateCosts = costRows.filter((row) =>
      costMatchesBillGroup(row, billGroup.group, billGroup.attributionLevel),
    );
    candidateCosts.forEach((row) => matchedCostEventIds.add(row.id));
    const projectedAmountUsd = roundUsd(
      candidateCosts.reduce((total, row) => total + row.amountUsd, 0),
    );
    const billedAmountUsd = roundUsd(
      billGroup.rows.reduce((total, row) => total + row.amountUsd, 0),
    );
    const varianceUsd = roundUsd(billedAmountUsd - projectedAmountUsd);
    const withinTolerance = Math.abs(varianceUsd) <= toleranceUsd;
    const canUpdateCostEvents = billGroup.attributionLevel === "tenant";
    const evidenceTenantId =
      billGroup.group.tenantId ?? singleTenantId(candidateCosts);

    decisions.push({
      state: withinTolerance ? "bill-reconciled" : "mismatch",
      reason: withinTolerance ? "within-tolerance" : "billing-variance",
      provider: billGroup.group.provider,
      serviceCode: billGroup.group.serviceCode,
      operation: billGroup.group.operation,
      model: billGroup.group.model,
      tenantId: evidenceTenantId,
      billingPeriodStart: billGroup.group.billingPeriodStart,
      billingPeriodEnd: billGroup.group.billingPeriodEnd,
      attributionLevel: billGroup.attributionLevel,
      attributionKey: billGroup.attributionKey,
      allocationConfidence: canUpdateCostEvents
        ? "exact-tenant"
        : "aggregate-only",
      projectedAmountUsd,
      billedAmountUsd,
      varianceUsd,
      toleranceUsd,
      sourceUri: billGroup.rows[0]?.sourceUri ?? null,
      usageAccountId: billGroup.rows[0]?.usageAccountId ?? null,
      billingLineItemIds: billGroup.rows.map((row) => row.id),
      costEventIdsToUpdate: canUpdateCostEvents
        ? candidateCosts.map((row) => row.id)
        : [],
      previousCostEventStates: candidateCosts.map((row) => ({
        costEventId: row.id,
        reconciliationState: row.reconciliationState,
      })),
    });
  }

  for (const costGroup of groupCostRows(
    costRows.filter((row) => !matchedCostEventIds.has(row.id)),
  ).values()) {
    decisions.push({
      state: "unreconciled/error",
      reason: "missing-bill-evidence",
      provider: costGroup.group.provider,
      serviceCode: costGroup.group.serviceCode,
      operation: costGroup.group.operation,
      model: costGroup.group.model,
      tenantId: costGroup.group.tenantId,
      billingPeriodStart: costGroup.group.billingPeriodStart,
      billingPeriodEnd: costGroup.group.billingPeriodEnd,
      attributionLevel: "tenant",
      attributionKey: costGroup.group.tenantId ?? "unknown-tenant",
      allocationConfidence: "exact-tenant",
      projectedAmountUsd: roundUsd(
        costGroup.rows.reduce((total, row) => total + row.amountUsd, 0),
      ),
      billedAmountUsd: 0,
      varianceUsd: roundUsd(
        -costGroup.rows.reduce((total, row) => total + row.amountUsd, 0),
      ),
      toleranceUsd,
      sourceUri: null,
      usageAccountId: null,
      billingLineItemIds: [],
      costEventIdsToUpdate: [],
      previousCostEventStates: costGroup.rows.map((row) => ({
        costEventId: row.id,
        reconciliationState: row.reconciliationState,
      })),
    });
  }

  return decisions.sort((left, right) =>
    left.serviceCode.localeCompare(right.serviceCode),
  );
}

export async function persistBillingExportImport(input: {
  manifestBucket: string;
  manifestKey: string;
  provider?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  lineItems: NormalizedBillingLineItem[];
  errorRows?: number;
  metadata?: Record<string, unknown>;
}): Promise<PersistedBillingExportImport> {
  const db = getDb();
  const [importRow] = await db
    .insert(billingExportImports)
    .values({
      provider: input.provider ?? "aws",
      source_type: "aws_cur",
      manifest_bucket: input.manifestBucket,
      manifest_key: input.manifestKey,
      billing_period_start: new Date(input.billingPeriodStart),
      billing_period_end: new Date(input.billingPeriodEnd),
      status: input.errorRows ? "imported_with_errors" : "imported",
      row_count: input.lineItems.length,
      error_count: input.errorRows ?? 0,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [
        billingExportImports.provider,
        billingExportImports.manifest_bucket,
        billingExportImports.manifest_key,
      ],
      set: {
        status: input.errorRows ? "imported_with_errors" : "imported",
        row_count: input.lineItems.length,
        error_count: input.errorRows ?? 0,
        metadata: input.metadata ?? {},
        imported_at: new Date(),
      },
    })
    .returning({ id: billingExportImports.id });

  if (input.lineItems.length > 0) {
    await db
      .insert(billingExportLineItems)
      .values(
        input.lineItems.map((item) => ({
          import_id: importRow.id,
          tenant_id: item.tenantId ?? undefined,
          provider: item.provider,
          line_item_id: item.lineItemId,
          usage_account_id: item.usageAccountId,
          service_code: item.serviceCode,
          operation: item.operation,
          line_item_type: item.lineItemType,
          usage_start: new Date(item.usageStart),
          usage_end: new Date(item.usageEnd),
          billing_period_start: new Date(item.billingPeriodStart),
          billing_period_end: new Date(item.billingPeriodEnd),
          amount_usd: String(item.amountUsd),
          usage_amount:
            item.usageAmount === null ? undefined : String(item.usageAmount),
          currency: item.currency,
          model: item.model,
          region: item.region,
          resource_id: item.resourceId,
          attribution_level: item.attributionLevel,
          attribution_key: item.attributionKey,
          source_uri: item.sourceUri,
          raw_row: item.raw,
        })),
      )
      .onConflictDoNothing();
  }

  return {
    importId: importRow.id,
    importedRows: input.lineItems.length,
    errorRows: input.errorRows ?? 0,
  };
}

export async function reconcileBillingImport(input: {
  importId: string;
  toleranceUsd?: number;
}): Promise<BillingReconciliationDecision[]> {
  const db = getDb();
  const billRows = await db
    .select({
      id: billingExportLineItems.id,
      importId: billingExportLineItems.import_id,
      tenantId: billingExportLineItems.tenant_id,
      provider: billingExportLineItems.provider,
      serviceCode: billingExportLineItems.service_code,
      operation: billingExportLineItems.operation,
      model: billingExportLineItems.model,
      usageAccountId: billingExportLineItems.usage_account_id,
      usageStart: billingExportLineItems.usage_start,
      usageEnd: billingExportLineItems.usage_end,
      billingPeriodStart: billingExportLineItems.billing_period_start,
      billingPeriodEnd: billingExportLineItems.billing_period_end,
      amountUsd: billingExportLineItems.amount_usd,
      attributionLevel: billingExportLineItems.attribution_level,
      attributionKey: billingExportLineItems.attribution_key,
      sourceUri: billingExportLineItems.source_uri,
    })
    .from(billingExportLineItems)
    .where(eq(billingExportLineItems.import_id, input.importId));

  const first = billRows[0];
  if (!first) return [];

  const periodStart = first.billingPeriodStart;
  const periodEnd = first.billingPeriodEnd;
  const costRows = await db
    .select({
      id: costEvents.id,
      tenantId: costEvents.tenant_id,
      provider: costEvents.provider,
      serviceCode: costEvents.billing_service_code,
      operation: costEvents.billing_operation,
      model: costEvents.model,
      amountUsd: costEvents.amount_usd,
      createdAt: costEvents.created_at,
      reconciliationState: costEvents.reconciliation_state,
    })
    .from(costEvents)
    .where(
      and(
        gte(costEvents.created_at, periodStart),
        lte(costEvents.created_at, periodEnd),
      ),
    );

  const decisions = reconcileBillingAggregates(
    costRows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      serviceCode: row.serviceCode,
      operation: row.operation,
      model: row.model,
      amountUsd: numberValue(row.amountUsd),
      createdAt: row.createdAt.toISOString(),
      reconciliationState: row.reconciliationState,
    })),
    billRows.map((row) => ({
      id: row.id,
      importId: row.importId,
      tenantId: row.tenantId,
      provider: row.provider,
      serviceCode: row.serviceCode,
      operation: row.operation,
      model: row.model,
      usageAccountId: row.usageAccountId,
      usageStart: row.usageStart.toISOString(),
      usageEnd: row.usageEnd.toISOString(),
      billingPeriodStart: row.billingPeriodStart.toISOString(),
      billingPeriodEnd: row.billingPeriodEnd.toISOString(),
      amountUsd: numberValue(row.amountUsd),
      attributionLevel: row.attributionLevel,
      attributionKey: row.attributionKey,
      sourceUri: row.sourceUri,
    })),
    { toleranceUsd: input.toleranceUsd },
  );
  await persistBillingReconciliationDecisions(decisions);
  return decisions;
}

async function persistBillingReconciliationDecisions(
  decisions: BillingReconciliationDecision[],
): Promise<void> {
  const db = getDb();
  for (const decision of decisions) {
    if (!decision.tenantId) continue;
    const sourceEvidenceId = await getOrCreateBillSourceEvidence(decision);
    await appendBillFact(decision, sourceEvidenceId);
    if (decision.costEventIdsToUpdate.length > 0) {
      await db
        .update(costEvents)
        .set({
          reconciliation_state: decision.state,
          reconciliation_source: "aws_cur",
          reconciliation_at: new Date(),
          billing_account_id: decision.usageAccountId,
          billing_service_code: decision.serviceCode,
          billing_operation: decision.operation,
          billing_period_start: new Date(decision.billingPeriodStart),
          billing_period_end: new Date(decision.billingPeriodEnd),
          billing_attribution_level: decision.attributionLevel,
          source_evidence_ref: {
            source_type: "aws_cur",
            trace_source_evidence_id: sourceEvidenceId,
            attribution_level: decision.attributionLevel,
            allocation_confidence: decision.allocationConfidence,
          },
          metadata: sql`coalesce(${costEvents.metadata}, '{}'::jsonb) || ${JSON.stringify(
            {
              bill_reconciliation: {
                state: decision.state,
                reason: decision.reason,
                billed_amount_usd: decision.billedAmountUsd,
                projected_amount_usd: decision.projectedAmountUsd,
                variance_usd: decision.varianceUsd,
                source_uri: decision.sourceUri,
              },
            },
          )}::jsonb`,
        })
        .where(
          and(
            eq(costEvents.tenant_id, decision.tenantId),
            inArray(costEvents.id, decision.costEventIdsToUpdate),
          ),
        );
    }
  }
}

async function getOrCreateBillSourceEvidence(
  decision: BillingReconciliationDecision,
): Promise<string> {
  const db = getDb();
  const sourceId = [
    decision.billingPeriodStart,
    decision.billingPeriodEnd,
    decision.attributionKey,
    decision.serviceCode,
    decision.operation,
    decision.model,
  ].join("|");
  const [existing] = await db
    .select({ id: traceSourceEvidence.id })
    .from(traceSourceEvidence)
    .where(
      and(
        eq(traceSourceEvidence.tenant_id, decision.tenantId!),
        eq(traceSourceEvidence.source_type, "aws_cur"),
        eq(traceSourceEvidence.source_id, sourceId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(traceSourceEvidence)
    .values({
      tenant_id: decision.tenantId!,
      source_type: "aws_cur",
      source_system: "aws.cur2",
      source_id: sourceId,
      uri: decision.sourceUri ?? undefined,
      observed_at: new Date(),
      summary: {
        state: decision.state,
        provider: decision.provider,
        service_code: decision.serviceCode,
        operation: decision.operation,
        model: decision.model,
        projected_amount_usd: decision.projectedAmountUsd,
        billed_amount_usd: decision.billedAmountUsd,
        variance_usd: decision.varianceUsd,
      },
      metadata: {
        billing_period_start: decision.billingPeriodStart,
        billing_period_end: decision.billingPeriodEnd,
        attribution_level: decision.attributionLevel,
        attribution_key: decision.attributionKey,
        allocation_confidence: decision.allocationConfidence,
        billing_line_item_ids: decision.billingLineItemIds,
      },
    })
    .returning({ id: traceSourceEvidence.id });
  return inserted.id;
}

async function appendBillFact(
  decision: BillingReconciliationDecision,
  sourceEvidenceId: string,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: traceCostReconciliationFacts.id })
    .from(traceCostReconciliationFacts)
    .where(
      and(
        eq(traceCostReconciliationFacts.tenant_id, decision.tenantId!),
        eq(traceCostReconciliationFacts.source_evidence_id, sourceEvidenceId),
        eq(traceCostReconciliationFacts.reconciliation_scope, "aggregate"),
        eq(traceCostReconciliationFacts.reconciliation_state, decision.state),
      ),
    )
    .limit(1);
  if (existing) return;

  await db.insert(traceCostReconciliationFacts).values({
    tenant_id: decision.tenantId!,
    source_evidence_id: sourceEvidenceId,
    reconciliation_state: decision.state,
    reconciliation_scope: "aggregate",
    provider: decision.provider,
    model: decision.model,
    attribution_level: decision.attributionLevel,
    provider_amount_usd: String(decision.projectedAmountUsd),
    billed_amount_usd: String(decision.billedAmountUsd),
    variance_usd: String(decision.varianceUsd),
    metadata: {
      source: "cost_bill_reconciler",
      reason: decision.reason,
      service_code: decision.serviceCode,
      operation: decision.operation,
      allocation_confidence: decision.allocationConfidence,
      billing_period_start: decision.billingPeriodStart,
      billing_period_end: decision.billingPeriodEnd,
      billing_line_item_ids: decision.billingLineItemIds,
      previous_cost_event_states: decision.previousCostEventStates,
    },
  });
}

function groupBillRows(rows: BillingLineItemForReconciliation[]) {
  const groups = new Map<
    string,
    {
      group: Group;
      attributionLevel: string;
      attributionKey: string;
      rows: BillingLineItemForReconciliation[];
    }
  >();
  for (const row of rows) {
    const group = billGroup(row);
    const key = group.key;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, {
        group,
        attributionLevel: row.attributionLevel,
        attributionKey: row.attributionKey,
        rows: [row],
      });
    }
  }
  return groups;
}

function groupCostRows(rows: CostEventForBillingReconciliation[]) {
  const groups = new Map<
    string,
    { group: Group; rows: CostEventForBillingReconciliation[] }
  >();
  for (const row of rows) {
    const group = costGroup(row);
    const existing = groups.get(group.key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(group.key, { group, rows: [row] });
    }
  }
  return groups;
}

function billGroup(row: BillingLineItemForReconciliation): Group {
  const tenantPart = row.tenantId ?? "account";
  const normalized = {
    tenantId: row.tenantId,
    provider: row.provider,
    serviceCode: row.serviceCode,
    operation: row.operation,
    model: normalizeModel(row.model),
    billingPeriodStart: row.billingPeriodStart,
    billingPeriodEnd: row.billingPeriodEnd,
  };
  return {
    ...normalized,
    key: [
      tenantPart,
      normalized.provider,
      normalized.serviceCode,
      normalized.operation,
      normalized.model,
      normalized.billingPeriodStart,
      normalized.billingPeriodEnd,
    ].join("|"),
  };
}

function costGroup(row: CostEventForBillingReconciliation): Group {
  const period = monthWindow(row.createdAt);
  const provider = costProviderToBillingProvider(row.provider);
  const serviceCode = row.serviceCode ?? serviceCodeForProvider(row.provider);
  const operation = row.operation ?? "unknown";
  const model = normalizeModel(row.model ?? "unknown");
  return {
    tenantId: row.tenantId,
    provider,
    serviceCode,
    operation,
    model,
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    key: [
      row.tenantId,
      provider,
      serviceCode,
      operation,
      model,
      period.start,
      period.end,
    ].join("|"),
  };
}

function costMatchesBillGroup(
  row: CostEventForBillingReconciliation,
  group: Group,
  attributionLevel: string,
): boolean {
  const cost = costGroup(row);
  return (
    (attributionLevel !== "tenant" || cost.tenantId === group.tenantId) &&
    cost.provider === group.provider &&
    cost.serviceCode === group.serviceCode &&
    compatibleOperation(cost.operation, group.operation) &&
    cost.model === group.model &&
    cost.billingPeriodStart === group.billingPeriodStart &&
    cost.billingPeriodEnd === group.billingPeriodEnd
  );
}

function compatibleOperation(left: string, right: string): boolean {
  return left === right || left === "unknown" || right === "unknown";
}

function singleTenantId(
  rows: CostEventForBillingReconciliation[],
): string | null {
  const tenantIds = [...new Set(rows.map((row) => row.tenantId))];
  return tenantIds.length === 1 ? tenantIds[0] : null;
}

function costProviderToBillingProvider(provider: string | null): string {
  return provider === "bedrock" || provider === "aws"
    ? "aws"
    : (provider ?? "unknown");
}

function serviceCodeForProvider(provider: string | null): string {
  return provider === "bedrock" || provider === "aws"
    ? "AmazonBedrock"
    : "unknown";
}

function monthWindow(iso: string): { start: string; end: string } {
  const date = new Date(iso);
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeModel(value: string): string {
  return value
    .split("/")
    .pop()!
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^amazon\./, "")
    .replace(/-v\d+:\d+$/, "");
}

function numberValue(value: number | string | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
