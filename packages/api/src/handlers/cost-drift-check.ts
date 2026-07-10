/**
 * cost-drift-check (THINK-245 U10, R9/AE5)
 *
 * Daily comparison of recorded per-model LLM cost against AWS Cost Explorer.
 * Runs after CE's daily refresh and compares day D-2 (CE lags ~24h; D-1 can
 * still be partial). Emits `CostDriftPercent` per model plus
 * `CostDriftCheckFailed` on CE errors; CloudWatch alarms on these publish to
 * the cost-alerts SNS topic so drift pages operators instead of being
 * discovered by a customer.
 *
 * CE mapping traps handled here (review-verified):
 * - Third-party Bedrock model charges surface under marketplace service
 *   names (e.g. "Claude 4.6 Sonnet (Amazon Bedrock Edition)"), NOT the
 *   "Amazon Bedrock" service — so we do not filter by SERVICE; we classify
 *   by USAGE_TYPE grammar and match models by normalized substring.
 * - RECORD_TYPE=Usage filter excludes credits/refunds/tax, which would
 *   distort per-model daily cost.
 * - All four token-type usage lines (input/output/cache-read/cache-write)
 *   are summed; missing cache lines are the most common reconciliation gap.
 */

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { costEvents } from "@thinkwork/database-pg/schema";
import { emitCostMetrics, type CostMetricPoint } from "../lib/cost-metrics.js";

const DRIFT_ALERT_THRESHOLD_PERCENT = 1;
const MIN_BILLED_USD_FOR_DRIFT = 0.05; // below this, percent drift is noise

// Cost Explorer is a global service; us-east-1 is its canonical endpoint.
const ce = new CostExplorerClient({ region: "us-east-1" });

/** Canonical model keys, matched against normalized (alphanumeric-only,
 * lowercase) usage types and cost_events.model values. Order matters —
 * most specific first. */
const MODEL_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["claude46sonnet", "claude-sonnet-4-6"],
  ["claudesonnet46", "claude-sonnet-4-6"],
  ["claude45sonnet", "claude-sonnet-4-5"],
  ["claudesonnet45", "claude-sonnet-4-5"],
  ["claude45haiku", "claude-haiku-4-5"],
  ["claudehaiku45", "claude-haiku-4-5"],
  ["claude3haiku", "claude-3-haiku"],
  ["kimik25", "kimi-k2.5"],
  ["kimik2", "kimi-k2"],
  ["gptoss120b", "gpt-oss-120b"],
  ["gptoss20b", "gpt-oss-20b"],
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function modelKeyFor(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalize(value);
  for (const [needle, key] of MODEL_KEYS) {
    if (normalized.includes(needle)) return key;
  }
  return null;
}

/** Token-type usage lines (any region/mantle/cross-region variant). */
export function isTokenUsageType(usageType: string): boolean {
  const normalized = usageType.toLowerCase();
  return normalized.includes("token"); // input-tokens / output-tokens / *-token-count
}

export interface DriftRow {
  model: string;
  billedUsd: number;
  recordedUsd: number;
  driftPercent: number;
}

export function computeDrift(
  billedByModel: Map<string, number>,
  recordedByModel: Map<string, number>,
): DriftRow[] {
  const models = new Set([...billedByModel.keys(), ...recordedByModel.keys()]);
  const rows: DriftRow[] = [];
  for (const model of models) {
    const billedUsd = billedByModel.get(model) ?? 0;
    const recordedUsd = recordedByModel.get(model) ?? 0;
    if (
      billedUsd < MIN_BILLED_USD_FOR_DRIFT &&
      recordedUsd < MIN_BILLED_USD_FOR_DRIFT
    ) {
      continue;
    }
    const denominator = Math.max(billedUsd, MIN_BILLED_USD_FOR_DRIFT);
    const driftPercent =
      Math.round(
        (Math.abs(billedUsd - recordedUsd) / denominator) * 100 * 100,
      ) / 100;
    rows.push({
      model,
      billedUsd: round6(billedUsd),
      recordedUsd: round6(recordedUsd),
      driftPercent,
    });
  }
  return rows.sort((a, b) => b.driftPercent - a.driftPercent);
}

export async function handler(): Promise<unknown> {
  const stage = process.env.STAGE || "dev";
  // Day D-2 UTC window.
  const now = new Date();
  const dayStartMs =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    2 * 24 * 60 * 60 * 1000;
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const day = new Date(dayStartMs).toISOString().slice(0, 10);

  let billedByModel: Map<string, number>;
  try {
    billedByModel = await fetchBilledByModel(dayStartMs, dayEndMs);
  } catch (err) {
    console.error("[cost-drift-check] Cost Explorer query failed:", err);
    emitCostMetrics([{ name: "CostDriftCheckFailed", value: 1 }]);
    return { ok: false, day, error: String(err) };
  }

  const db = getDb();
  const recordedRows = await db
    .select({
      model: costEvents.model,
      totalUsd: sql<number>`COALESCE(SUM(${costEvents.amount_usd}), 0)::float`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.event_type, "llm"),
        gte(costEvents.created_at, new Date(dayStartMs)),
        lt(costEvents.created_at, new Date(dayEndMs)),
      ),
    )
    .groupBy(costEvents.model);
  const recordedByModel = new Map<string, number>();
  for (const row of recordedRows) {
    const key = modelKeyFor(row.model) ?? "unknown";
    recordedByModel.set(key, (recordedByModel.get(key) ?? 0) + row.totalUsd);
  }

  const rows = computeDrift(billedByModel, recordedByModel);
  const points: CostMetricPoint[] = [
    { name: "CostDriftCheckFailed", value: 0 },
  ];
  for (const row of rows) {
    // AE5 — the alert names environment, model, and gap.
    console.log(
      JSON.stringify({
        msg: "cost-drift-check.model",
        stage,
        day,
        model: row.model,
        billedUsd: row.billedUsd,
        recordedUsd: row.recordedUsd,
        driftPercent: row.driftPercent,
        breach: row.driftPercent > DRIFT_ALERT_THRESHOLD_PERCENT,
      }),
    );
  }
  const maxDrift = rows.reduce(
    (max, row) => Math.max(max, row.driftPercent),
    0,
  );
  points.push({ name: "CostDriftPercent", value: maxDrift, unit: "Percent" });
  emitCostMetrics(points);

  return { ok: true, day, rows, maxDriftPercent: maxDrift };
}

async function fetchBilledByModel(
  startMs: number,
  endMs: number,
): Promise<Map<string, number>> {
  const billed = new Map<string, number>();
  let nextToken: string | undefined;
  do {
    const response = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: {
          Start: new Date(startMs).toISOString().slice(0, 10),
          End: new Date(endMs).toISOString().slice(0, 10),
        },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [
          { Type: "DIMENSION", Key: "SERVICE" },
          { Type: "DIMENSION", Key: "USAGE_TYPE" },
        ],
        Filter: {
          Dimensions: { Key: "RECORD_TYPE", Values: ["Usage"] },
        },
        NextPageToken: nextToken,
      }),
    );
    for (const result of response.ResultsByTime ?? []) {
      for (const group of result.Groups ?? []) {
        const [service = "", usageType = ""] = group.Keys ?? [];
        if (!isTokenUsageType(usageType)) continue;
        const model = modelKeyFor(usageType) ?? modelKeyFor(service);
        if (!model) continue;
        const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
        if (!Number.isFinite(amount) || amount === 0) continue;
        billed.set(model, (billed.get(model) ?? 0) + amount);
      }
    }
    nextToken = response.NextPageToken;
  } while (nextToken);
  return billed;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
