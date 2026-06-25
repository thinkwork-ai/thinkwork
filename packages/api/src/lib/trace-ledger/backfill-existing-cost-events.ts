import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  traceCostReconciliationFacts,
  traceEvents,
  traceRuns,
  traceSourceEvidence,
  type TraceEventType,
} from "@thinkwork/database-pg/schema";

const db = getDb();

type JsonRecord = Record<string, unknown>;

export interface HistoricalCostEventRow {
  id: string;
  tenant_id: string;
  agent_id?: string | null;
  user_id?: string | null;
  thread_id?: string | null;
  request_id: string;
  event_type: string;
  runtime_type?: string | null;
  amount_usd: unknown;
  model?: string | null;
  provider?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_read_tokens?: number | null;
  duration_ms?: number | null;
  trace_id?: string | null;
  reconciliation_state?: string | null;
  source_evidence_ref?: unknown;
  metadata?: unknown;
  created_at?: Date | string | null;
}

export interface HistoricalThreadTurnUsageRow {
  id: string;
  tenant_id: string;
  agent_id?: string | null;
  user_id?: string | null;
  thread_id?: string | null;
  runtime_type?: string | null;
  status?: string | null;
  usage_json?: unknown;
  started_at?: Date | string | null;
  finished_at?: Date | string | null;
}

export interface HistoricalBackfillPlan {
  traceId: string;
  run: {
    tenant_id: string;
    trace_id: string;
    thread_id?: string | null;
    thread_turn_id?: string | null;
    agent_id?: string | null;
    user_id?: string | null;
    runtime_type?: string | null;
    status: string;
    started_at?: Date | string | null;
    finished_at?: Date | string | null;
  };
  event: {
    tenant_id: string;
    thread_turn_id?: string | null;
    request_id: string;
    event_type: TraceEventType;
    event_status: string;
    observed_at?: Date | string | null;
    duration_ms?: number | null;
    payload_summary: JsonRecord;
    source_evidence_ref: JsonRecord;
    metadata: JsonRecord;
  };
  sourceEvidence: {
    tenant_id: string;
    source_type: "backfill";
    source_system: string;
    source_id: string;
    observed_at?: Date | string | null;
    summary: JsonRecord;
    redaction_state: "summary_only";
    metadata: JsonRecord;
  };
  reconciliationFact: {
    tenant_id: string;
    cost_event_id?: string | null;
    reconciliation_state: "unreconciled/error";
    reconciliation_scope: "runtime";
    provider?: string | null;
    model?: string | null;
    request_id: string;
    attribution_level: string;
    runtime_input_tokens?: number | null;
    runtime_output_tokens?: number | null;
    runtime_cached_read_tokens?: number | null;
    runtime_amount_usd?: string | null;
    metadata: JsonRecord;
  };
  costEventUpdate?: {
    costEventId: string;
    reconciliation_state: "unreconciled/error";
    reconciliation_source: "backfill";
    source_evidence_ref: JsonRecord;
  };
}

export interface BackfillExistingCostEventsResult {
  scanned: number;
  backfilled: number;
}

export function buildHistoricalCostEventBackfillPlan(
  row: HistoricalCostEventRow,
): HistoricalBackfillPlan {
  const traceId = row.trace_id?.trim() || `backfill:cost-event:${row.id}`;
  const payload = stripUndefined({
    model: row.model,
    provider: row.provider,
    event_type: row.event_type,
    runtime_type: row.runtime_type,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cached_read_tokens: row.cached_read_tokens,
    amount_usd: numericString(row.amount_usd),
    duration_ms: row.duration_ms,
    historical_observation: true,
    prior_reconciliation_state: row.reconciliation_state,
  });
  const sourceRef = {
    source_type: "backfill",
    source_system: "thinkwork.cost_events",
    source_id: row.id,
  };
  return {
    traceId,
    run: {
      tenant_id: row.tenant_id,
      trace_id: traceId,
      thread_id: row.thread_id ?? null,
      agent_id: row.agent_id ?? null,
      user_id: row.user_id ?? null,
      runtime_type: row.runtime_type ?? null,
      status: "historical",
      finished_at: row.created_at ?? null,
    },
    event: {
      tenant_id: row.tenant_id,
      request_id: row.request_id,
      event_type: traceEventTypeForCostEvent(row.event_type),
      event_status: "historical",
      observed_at: row.created_at ?? null,
      duration_ms: row.duration_ms ?? null,
      payload_summary: payload,
      source_evidence_ref: sourceRef,
      metadata: {
        source: "historical_cost_event_backfill",
        backfill_reason: "pre_trace_ledger_cost_event",
      },
    },
    sourceEvidence: {
      tenant_id: row.tenant_id,
      source_type: "backfill",
      source_system: "thinkwork.cost_events",
      source_id: row.id,
      observed_at: row.created_at ?? null,
      summary: payload,
      redaction_state: "summary_only",
      metadata: {
        cost_event_id: row.id,
        historical_observation: true,
      },
    },
    reconciliationFact: {
      tenant_id: row.tenant_id,
      cost_event_id: row.id,
      reconciliation_state: "unreconciled/error",
      reconciliation_scope: "runtime",
      provider: row.provider ?? null,
      model: row.model ?? null,
      request_id: row.request_id,
      attribution_level: "historical_cost_event",
      runtime_input_tokens: row.input_tokens ?? null,
      runtime_output_tokens: row.output_tokens ?? null,
      runtime_cached_read_tokens: row.cached_read_tokens ?? null,
      runtime_amount_usd: numericString(row.amount_usd),
      metadata: {
        source: "historical_cost_event_backfill",
        reason:
          "Historical cost row predates provider/billing evidence capture; no provider or bill reconciliation is inferred.",
      },
    },
    costEventUpdate: {
      costEventId: row.id,
      reconciliation_state: "unreconciled/error",
      reconciliation_source: "backfill",
      source_evidence_ref: sourceRef,
    },
  };
}

export function buildHistoricalThreadTurnUsageBackfillPlan(
  row: HistoricalThreadTurnUsageRow,
): HistoricalBackfillPlan | null {
  const usage = readRecord(row.usage_json);
  const inputTokens = numberValue(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens,
  );
  const outputTokens = numberValue(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens,
  );
  const cachedReadTokens = numberValue(
    usage.cached_read_tokens ??
      usage.cachedReadTokens ??
      usage.cache_read_input_tokens,
  );
  const amountUsd = numberValue(usage.cost_usd ?? usage.amount_usd);
  const model = stringValue(usage.model ?? usage.modelId);
  if (
    !model &&
    inputTokens == null &&
    outputTokens == null &&
    cachedReadTokens == null &&
    amountUsd == null
  ) {
    return null;
  }

  const traceId = `backfill:thread-turn:${row.id}`;
  const payload = stripUndefined({
    model,
    runtime_type: row.runtime_type,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_read_tokens: cachedReadTokens,
    amount_usd: amountUsd,
    historical_observation: true,
  });
  const sourceRef = {
    source_type: "backfill",
    source_system: "thinkwork.thread_turns.usage_json",
    source_id: row.id,
  };
  return {
    traceId,
    run: {
      tenant_id: row.tenant_id,
      trace_id: traceId,
      thread_id: row.thread_id ?? null,
      thread_turn_id: row.id,
      agent_id: row.agent_id ?? null,
      user_id: row.user_id ?? null,
      runtime_type: row.runtime_type ?? null,
      status: row.status ?? "historical",
      started_at: row.started_at ?? null,
      finished_at: row.finished_at ?? null,
    },
    event: {
      tenant_id: row.tenant_id,
      thread_turn_id: row.id,
      request_id: row.id,
      event_type: "cost_observation",
      event_status: "historical",
      observed_at: row.finished_at ?? row.started_at ?? null,
      payload_summary: payload,
      source_evidence_ref: sourceRef,
      metadata: {
        source: "historical_thread_turn_usage_backfill",
        backfill_reason: "pre_trace_ledger_usage_json",
      },
    },
    sourceEvidence: {
      tenant_id: row.tenant_id,
      source_type: "backfill",
      source_system: "thinkwork.thread_turns.usage_json",
      source_id: row.id,
      observed_at: row.finished_at ?? row.started_at ?? null,
      summary: payload,
      redaction_state: "summary_only",
      metadata: {
        thread_turn_id: row.id,
        historical_observation: true,
      },
    },
    reconciliationFact: {
      tenant_id: row.tenant_id,
      reconciliation_state: "unreconciled/error",
      reconciliation_scope: "runtime",
      model,
      request_id: row.id,
      attribution_level: "historical_thread_turn_usage",
      runtime_input_tokens: inputTokens,
      runtime_output_tokens: outputTokens,
      runtime_cached_read_tokens: cachedReadTokens,
      runtime_amount_usd: amountUsd == null ? null : String(amountUsd),
      metadata: {
        source: "historical_thread_turn_usage_backfill",
        reason:
          "Historical usage_json predates provider/billing evidence capture; no provider or bill reconciliation is inferred.",
      },
    },
  };
}

export async function backfillExistingCostEvents(
  opts: {
    tenantId?: string;
    limit?: number;
  } = {},
): Promise<BackfillExistingCostEventsResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5_000));
  const conditions = [isNull(costEvents.trace_event_id)];
  if (opts.tenantId) conditions.push(eq(costEvents.tenant_id, opts.tenantId));
  const rows = (await db
    .select({
      id: costEvents.id,
      tenant_id: costEvents.tenant_id,
      agent_id: costEvents.agent_id,
      user_id: costEvents.user_id,
      thread_id: costEvents.thread_id,
      request_id: costEvents.request_id,
      event_type: costEvents.event_type,
      runtime_type: costEvents.runtime_type,
      amount_usd: costEvents.amount_usd,
      model: costEvents.model,
      provider: costEvents.provider,
      input_tokens: costEvents.input_tokens,
      output_tokens: costEvents.output_tokens,
      cached_read_tokens: costEvents.cached_read_tokens,
      duration_ms: costEvents.duration_ms,
      trace_id: costEvents.trace_id,
      reconciliation_state: costEvents.reconciliation_state,
      source_evidence_ref: costEvents.source_evidence_ref,
      metadata: costEvents.metadata,
      created_at: costEvents.created_at,
    })
    .from(costEvents)
    .where(and(...conditions))
    .limit(limit)) as HistoricalCostEventRow[];

  let backfilled = 0;
  for (const row of rows) {
    await persistHistoricalBackfillPlan(
      buildHistoricalCostEventBackfillPlan(row),
    );
    backfilled += 1;
  }
  return { scanned: rows.length, backfilled };
}

async function persistHistoricalBackfillPlan(
  plan: HistoricalBackfillPlan,
): Promise<void> {
  const [run] = await db
    .insert(traceRuns)
    .values({
      ...plan.run,
      finished_at: dateValue(plan.run.finished_at),
      started_at: dateValue(plan.run.started_at),
    })
    .onConflictDoUpdate({
      target: [traceRuns.tenant_id, traceRuns.trace_id],
      set: {
        thread_id: plan.run.thread_id ?? undefined,
        thread_turn_id: plan.run.thread_turn_id ?? undefined,
        agent_id: plan.run.agent_id ?? undefined,
        user_id: plan.run.user_id ?? undefined,
        runtime_type: plan.run.runtime_type ?? undefined,
        status: plan.run.status,
        finished_at: dateValue(plan.run.finished_at),
        updated_at: sql`now()`,
      },
    })
    .returning({ id: traceRuns.id });

  const [event] = await db
    .insert(traceEvents)
    .values({
      tenant_id: plan.event.tenant_id,
      trace_run_id: run.id,
      thread_turn_id: plan.event.thread_turn_id ?? undefined,
      request_id: plan.event.request_id,
      event_type: plan.event.event_type,
      event_status: plan.event.event_status,
      observed_at: dateValue(plan.event.observed_at),
      duration_ms: plan.event.duration_ms ?? undefined,
      payload_summary: plan.event.payload_summary,
      source_evidence_ref: plan.event.source_evidence_ref,
      metadata: plan.event.metadata,
    })
    .returning({ id: traceEvents.id });

  const [source] = await db
    .insert(traceSourceEvidence)
    .values({
      tenant_id: plan.sourceEvidence.tenant_id,
      trace_run_id: run.id,
      trace_event_id: event.id,
      source_type: plan.sourceEvidence.source_type,
      source_system: plan.sourceEvidence.source_system,
      source_id: plan.sourceEvidence.source_id,
      observed_at: dateValue(plan.sourceEvidence.observed_at),
      summary: plan.sourceEvidence.summary,
      redaction_state: plan.sourceEvidence.redaction_state,
      metadata: plan.sourceEvidence.metadata,
    })
    .returning({ id: traceSourceEvidence.id });

  await db.insert(traceCostReconciliationFacts).values({
    ...plan.reconciliationFact,
    trace_run_id: run.id,
    trace_event_id: event.id,
    source_evidence_id: source.id,
  });

  if (plan.costEventUpdate) {
    await db
      .update(costEvents)
      .set({
        trace_id: plan.traceId,
        trace_event_id: event.id,
        reconciliation_state: plan.costEventUpdate.reconciliation_state,
        reconciliation_source: plan.costEventUpdate.reconciliation_source,
        reconciliation_at: new Date(),
        source_evidence_ref: {
          ...plan.costEventUpdate.source_evidence_ref,
          trace_run_id: run.id,
          trace_event_id: event.id,
          trace_source_evidence_id: source.id,
        },
        metadata: sql`coalesce(${costEvents.metadata}, '{}'::jsonb) || ${JSON.stringify(
          {
            trace_ledger_backfill: {
              trace_run_id: run.id,
              trace_event_id: event.id,
              reconciliation_state: "unreconciled/error",
            },
          },
        )}::jsonb`,
      })
      .where(eq(costEvents.id, plan.costEventUpdate.costEventId));
  }
}

function traceEventTypeForCostEvent(eventType: string): TraceEventType {
  if (eventType === "llm") return "model_invocation";
  if (eventType === "agentcore_compute") return "runtime_phase";
  return "cost_observation";
}

function numericString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stripUndefined(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null,
    ),
  );
}

function dateValue(value: Date | string | null | undefined): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return undefined;
}
