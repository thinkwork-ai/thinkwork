/**
 * THINK-245 U7 — graced historical cost backfill.
 *
 * Corrects historical cost_events to provider-billed truth from retained
 * Bedrock invocation logs, in two passes per UTC day:
 *
 *   Pass 1 — per-turn correction: every runtime-reported llm event in the
 *   window is re-run through the production reconciler matcher
 *   (`reconcileBedrockInvocationsForTurn`), so corrected rows carry real
 *   provider evidence and append-only facts (no-silent-upgrade convention).
 *   Rows whose amount the correction RAISED are marked `enforcement_exempt`
 *   so budget windows never trip retroactively (R11).
 *
 *   Pass 2 — daily adjustment: any residual gap between the day's provider
 *   log total and the day's recorded total (per model) lands as ONE
 *   synthetic, enforcement-exempt adjustment event. This absorbs both
 *   historically unmetered background consumers (which have no rows to
 *   correct) and pre-fix ambiguous windows where per-turn attribution is
 *   impossible — daily tenant totals become true even where per-turn splits
 *   stay approximate. Idempotent via a stable request_id per (day, model).
 *
 * Tenant attribution for pass 2 comes from `tenantId` (operator-supplied —
 * the stage's tenant; TEI/McPherson are single-tenant). On multi-stage AWS
 * accounts the shared invocation log group can carry another stage's
 * records, so ALWAYS dry-run first and eyeball the per-day table before
 * applying (`apply: true`).
 *
 * Backfill depth is bounded by log retention (30 days) — compute acceptance
 * against the log-covered window, not calendar ambitions.
 *
 * Run from packages/api with stage DB credentials resolved via the
 * `thinkwork-<stage>-db-credentials` Secrets Manager convention (never an
 * ad-hoc exported plaintext DATABASE_URL):
 *
 *   npx tsx -e "import('./src/lib/trace-ledger/backfill-invocation-costs.js').then(m => m.backfillInvocationCosts({ tenantId: '<tenant-uuid>', startMs: Date.parse('2026-06-10'), endMs: Date.parse('2026-07-09'), apply: false })).then(r => console.log(JSON.stringify(r, null, 2)))"
 */

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { costEvents, traceEvents } from "@thinkwork/database-pg/schema";
import {
  fetchBedrockInvocationLogsForWindow,
  reconcileBedrockInvocationsForTurn,
  shortenModelId,
  type CloudWatchLogsClientLike,
} from "./bedrock-invocation-reconciler.js";
import { modelKeyFor } from "../../handlers/cost-drift-check.js";

/** Canonical per-model bucket key for pass 2. Provider records carry ARNs /
 * inference-profile ids while cost_events.model mixes raw ids with
 * reconciler-shortened names — bucketing both sides through modelKeyFor
 * keeps same-model spend aligned (raw-key mismatch would double-count). */
function bucketKey(model: string | null): string {
  return modelKeyFor(model) ?? shortenModelId(model ?? "unknown");
}

const ADJUSTMENT_EPSILON_USD = 0.0005; // below CE rounding; skip noise

/** Pure: the residual a day's adjustment row should carry (0 = none). */
export function computeDailyAdjustmentUsd(
  providerUsd: number,
  recordedUsd: number,
): number {
  const delta = Math.round((providerUsd - recordedUsd) * 1_000_000) / 1_000_000;
  return delta > ADJUSTMENT_EPSILON_USD ? delta : 0;
}

/** Pure: the synthetic daily-adjustment cost event (KTD6 pass 2). */
export function buildDailyAdjustmentEvent(input: {
  tenantId: string;
  day: string;
  model: string;
  adjustmentUsd: number;
  providerUsd: number;
  recordedUsd: number;
  dayEndMs: number;
}): typeof costEvents.$inferInsert {
  return {
    tenant_id: input.tenantId,
    request_id: `backfill:${input.day}:${input.model}`,
    event_type: "llm",
    amount_usd: input.adjustmentUsd.toFixed(6),
    model: input.model,
    provider: "bedrock",
    reconciliation_state: "invocation-reconciled",
    reconciliation_source: "bedrock_invocation_log",
    reconciliation_at: new Date(),
    enforcement_exempt: true,
    created_at: new Date(input.dayEndMs - 1),
    source_evidence_ref: {
      source_type: "bedrock_invocation_log",
      backfill: "daily_adjustment",
      day: input.day,
    },
    metadata: {
      source: "backfill_daily_adjustment",
      approximate_attribution: true,
      provider_usd: round6(input.providerUsd),
      recorded_usd_before: round6(input.recordedUsd),
    },
  };
}

export interface BackfillDayResult {
  day: string;
  model: string;
  providerUsd: number;
  recordedUsd: number;
  adjustmentUsd: number;
  adjustmentApplied: boolean;
}

export interface BackfillInvocationCostsResult {
  turnsReconciled: number;
  turnsMatched: number;
  turnsUnreconciled: number;
  eventsExempted: number;
  days: BackfillDayResult[];
  applied: boolean;
}

export async function backfillInvocationCosts(input: {
  /** Tenant that owns pass-2 daily adjustments (the stage's tenant). */
  tenantId: string;
  startMs: number;
  endMs: number;
  /** false (default) = dry run: report, write nothing. */
  apply?: boolean;
  cloudWatch?: CloudWatchLogsClientLike;
  logGroupName?: string;
}): Promise<BackfillInvocationCostsResult> {
  const db = getDb();
  const apply = input.apply === true;
  const start = new Date(input.startMs);
  const end = new Date(input.endMs);

  // ---- Pass 1: per-turn correction through the production matcher ----
  const turnRows = await db
    .select({
      tenantId: costEvents.tenant_id,
      turnId: traceEvents.thread_turn_id,
    })
    .from(costEvents)
    .innerJoin(traceEvents, eq(costEvents.trace_event_id, traceEvents.id))
    .where(
      and(
        eq(costEvents.event_type, "llm"),
        eq(costEvents.reconciliation_state, "runtime-reported"),
        gte(costEvents.created_at, start),
        lt(costEvents.created_at, end),
        sql`${traceEvents.thread_turn_id} IS NOT NULL`,
      ),
    );
  const uniqueTurns = [
    ...new Map(
      turnRows
        .filter((row) => row.turnId)
        .map((row) => [`${row.tenantId}:${row.turnId}`, row]),
    ).values(),
  ];

  let turnsMatched = 0;
  let turnsUnreconciled = 0;
  let eventsExempted = 0;

  for (const turn of uniqueTurns) {
    const before = await loadTurnAmounts(turn.tenantId, turn.turnId!);
    if (!apply) continue;
    const result = await reconcileBedrockInvocationsForTurn({
      tenantId: turn.tenantId,
      turnId: turn.turnId!,
      cloudWatch: input.cloudWatch,
      logGroupName: input.logGroupName,
    });
    turnsMatched += result.matched;
    turnsUnreconciled += result.unreconciled;
    const after = await loadTurnAmounts(turn.tenantId, turn.turnId!);
    const raisedIds = [...after.entries()]
      .filter(([id, amount]) => amount > (before.get(id) ?? 0))
      .map(([id]) => id);
    if (raisedIds.length > 0) {
      await db
        .update(costEvents)
        .set({ enforcement_exempt: true })
        .where(
          and(
            eq(costEvents.tenant_id, turn.tenantId),
            inArray(costEvents.id, raisedIds),
          ),
        );
      eventsExempted += raisedIds.length;
    }
  }

  // ---- Pass 2: daily per-model adjustment for the residual gap ----
  const days: BackfillDayResult[] = [];
  for (
    let dayStart = utcDayStart(input.startMs);
    dayStart < input.endMs;
    dayStart += 24 * 60 * 60 * 1000
  ) {
    const dayEnd = Math.min(dayStart + 24 * 60 * 60 * 1000, input.endMs);
    const day = new Date(dayStart).toISOString().slice(0, 10);

    const providerRecords = await fetchBedrockInvocationLogsForWindow({
      startMs: dayStart,
      endMs: dayEnd,
      cloudWatch: input.cloudWatch,
      logGroupName: input.logGroupName,
      limit: 10_000,
    });
    const providerByModel = new Map<string, number>();
    for (const record of providerRecords) {
      const model = bucketKey(record.modelId);
      providerByModel.set(
        model,
        (providerByModel.get(model) ?? 0) + record.costUsd,
      );
    }

    const recordedRows = await db
      .select({
        model: costEvents.model,
        totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
      })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.event_type, "llm"),
          gte(costEvents.created_at, new Date(dayStart)),
          lt(costEvents.created_at, new Date(dayEnd)),
        ),
      )
      .groupBy(costEvents.model);
    const recordedByModel = new Map<string, number>();
    for (const row of recordedRows) {
      const key = bucketKey(row.model);
      recordedByModel.set(key, (recordedByModel.get(key) ?? 0) + row.totalUsd);
    }

    for (const [model, providerUsd] of providerByModel) {
      const recordedUsd = recordedByModel.get(model) ?? 0;
      const adjustmentUsd = computeDailyAdjustmentUsd(providerUsd, recordedUsd);
      const shouldAdjust = adjustmentUsd > 0;
      days.push({
        day,
        model,
        providerUsd: round6(providerUsd),
        recordedUsd: round6(recordedUsd),
        adjustmentUsd,
        adjustmentApplied: apply && shouldAdjust,
      });
      if (!apply || !shouldAdjust) continue;
      await db
        .insert(costEvents)
        .values(
          buildDailyAdjustmentEvent({
            tenantId: input.tenantId,
            day,
            model,
            adjustmentUsd,
            providerUsd,
            recordedUsd,
            dayEndMs: dayEnd,
          }),
        )
        .onConflictDoNothing();
    }
  }

  return {
    turnsReconciled: apply ? uniqueTurns.length : 0,
    turnsMatched,
    turnsUnreconciled,
    eventsExempted,
    days,
    applied: apply,
  };
}

async function loadTurnAmounts(
  tenantId: string,
  turnId: string,
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      id: costEvents.id,
      amountUsd: costEvents.amount_usd,
      turnId: traceEvents.thread_turn_id,
    })
    .from(costEvents)
    .innerJoin(traceEvents, eq(costEvents.trace_event_id, traceEvents.id))
    .where(
      and(
        eq(costEvents.tenant_id, tenantId),
        eq(costEvents.event_type, "llm"),
        eq(traceEvents.thread_turn_id, turnId),
      ),
    );
  return new Map(rows.map((row) => [row.id, Number(row.amountUsd)]));
}

function utcDayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
