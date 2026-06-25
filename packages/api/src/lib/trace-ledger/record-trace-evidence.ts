import { and, eq, inArray, sql } from "drizzle-orm";
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

export interface RuntimeUsageEvidence {
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  costUsd?: number | null;
}

export interface RuntimeToolInvocationEvidence extends JsonRecord {
  id?: unknown;
  tool_call_id?: unknown;
  toolCallId?: unknown;
  tool_name?: unknown;
  toolName?: unknown;
  name?: unknown;
  model?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  cached_read_tokens?: unknown;
  cost_usd?: unknown;
  duration_ms?: unknown;
  is_error?: unknown;
  status?: unknown;
}

export interface RuntimeModelRoutedToolEvidence {
  toolCallId: string;
  toolName: string;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  durationMs: number;
  costUsd?: number;
  error?: string;
  match?: JsonRecord;
  ruleSource?: JsonRecord;
}

export interface RuntimeAgentProfileRunEvidence {
  profileRunId: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  model: string;
  status: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  costUsd?: number;
  laneKey?: string;
  error?: string;
}

export interface RuntimeFinalizeEvidenceInput {
  tenantId: string;
  agentId: string;
  userId?: string | null;
  threadId: string;
  threadTurnId: string;
  traceId?: string | null;
  runtimeType?: string | null;
  status: "completed" | "failed" | "succeeded" | string;
  durationMs: number;
  responseText?: string | null;
  errorMessage?: string | null;
  usage: RuntimeUsageEvidence;
  diagnostics?: JsonRecord;
  reconcile?: unknown;
  toolInvocations?: RuntimeToolInvocationEvidence[];
  modelRoutedToolCalls?: RuntimeModelRoutedToolEvidence[];
  agentProfileRuns?: RuntimeAgentProfileRunEvidence[];
  bedrockRequestIds?: unknown;
}

export interface TraceEvidenceEventPlan {
  key: string;
  parentKey?: string;
  eventType: TraceEventType;
  eventStatus?: string | null;
  requestId?: string | null;
  parentRequestId?: string | null;
  durationMs?: number | null;
  payloadSummary: JsonRecord;
  sourceEvidenceRef?: JsonRecord;
  metadata?: JsonRecord;
}

export interface TraceEvidenceCostLinkPlan {
  eventKey: string;
  requestId: string;
  eventType: string;
  attributionLevel: string;
}

export interface TraceEvidencePlan {
  traceId: string;
  status: string;
  events: TraceEvidenceEventPlan[];
  costLinks: TraceEvidenceCostLinkPlan[];
}

export interface RecordTraceEvidenceResult {
  traceRunId: string;
  traceEventIds: Record<string, string>;
  costEventIds: string[];
}

export function buildTraceEvidencePlan(
  input: RuntimeFinalizeEvidenceInput,
): TraceEvidencePlan {
  const traceId = input.traceId?.trim() || input.threadTurnId;
  const events: TraceEvidenceEventPlan[] = [];
  const costLinks: TraceEvidenceCostLinkPlan[] = [];
  const turnStatus = input.status === "completed" ? "succeeded" : input.status;
  const responseLength =
    typeof input.responseText === "string" ? input.responseText.length : 0;

  events.push({
    key: "turn",
    eventType: "turn",
    eventStatus: turnStatus,
    requestId: input.threadTurnId,
    durationMs: input.durationMs,
    payloadSummary: stripUndefined({
      thread_id: input.threadId,
      thread_turn_id: input.threadTurnId,
      runtime_type: input.runtimeType,
      response_length: responseLength,
      error_message: input.errorMessage,
    }),
    sourceEvidenceRef: runtimeSourceRef(input, "turn"),
    metadata: stripUndefined({
      source: "chat_finalize",
      trace_id: traceId,
    }),
  });

  if (input.usage.model || hasTokenOrCostEvidence(input.usage)) {
    events.push({
      key: "parent-model",
      parentKey: "turn",
      eventType: "model_invocation",
      eventStatus: turnStatus,
      requestId: input.threadTurnId,
      parentRequestId: input.threadTurnId,
      durationMs: input.durationMs,
      payloadSummary: stripUndefined({
        model: input.usage.model,
        input_tokens: input.usage.inputTokens,
        output_tokens: input.usage.outputTokens,
        cached_read_tokens: input.usage.cachedReadTokens,
        cost_usd: input.usage.costUsd,
        bedrock_request_ids: arrayValue(input.bedrockRequestIds),
        runtime_reported_zero_tokens:
          input.usage.inputTokens === 0 && input.usage.outputTokens === 0,
      }),
      sourceEvidenceRef: runtimeSourceRef(input, "parent-model"),
      metadata: { attribution_level: "turn_parent_model" },
    });
    costLinks.push({
      eventKey: "parent-model",
      requestId: input.threadTurnId,
      eventType: "llm",
      attributionLevel: "turn_parent_model",
    });
  }

  events.push({
    key: "runtime-compute",
    parentKey: "turn",
    eventType: "runtime_phase",
    eventStatus: turnStatus,
    requestId: input.threadTurnId,
    durationMs: input.durationMs,
    payloadSummary: stripUndefined({
      phase: "agentcore_compute",
      runtime_type: input.runtimeType,
      duration_ms: input.durationMs,
    }),
    sourceEvidenceRef: runtimeSourceRef(input, "runtime-compute"),
    metadata: { attribution_level: "runtime_compute" },
  });
  costLinks.push({
    eventKey: "runtime-compute",
    requestId: input.threadTurnId,
    eventType: "agentcore_compute",
    attributionLevel: "runtime_compute",
  });

  appendDiagnosticPhaseEvents(events, input);
  appendWorkspaceReconcileEvent(events, input);
  appendToolEvents(events, costLinks, input);
  appendProfileEvents(events, costLinks, input);

  events.push({
    key: "response-finalization",
    parentKey: "turn",
    eventType: "response_finalization",
    eventStatus: turnStatus,
    requestId: `${input.threadTurnId}:finalize`,
    durationMs: null,
    payloadSummary: stripUndefined({
      response_length: responseLength,
      has_error: Boolean(input.errorMessage),
    }),
    sourceEvidenceRef: runtimeSourceRef(input, "response-finalization"),
    metadata: { source: "process_finalize" },
  });

  return { traceId, status: turnStatus, events, costLinks };
}

export async function recordTraceEvidence(
  input: RuntimeFinalizeEvidenceInput,
): Promise<RecordTraceEvidenceResult> {
  const plan = buildTraceEvidencePlan(input);
  const [run] = await db
    .insert(traceRuns)
    .values({
      tenant_id: input.tenantId,
      trace_id: plan.traceId,
      thread_id: input.threadId,
      thread_turn_id: input.threadTurnId,
      agent_id: input.agentId,
      user_id: input.userId || undefined,
      runtime_type: input.runtimeType || undefined,
      status: plan.status,
      finished_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [traceRuns.tenant_id, traceRuns.trace_id],
      set: {
        thread_id: input.threadId,
        thread_turn_id: input.threadTurnId,
        agent_id: input.agentId,
        user_id: input.userId || undefined,
        runtime_type: input.runtimeType || undefined,
        status: plan.status,
        finished_at: new Date(),
        updated_at: sql`now()`,
      },
    })
    .returning({ id: traceRuns.id });

  const traceRunId = run.id;
  const traceEventIds: Record<string, string> = {};
  const sourceEvidenceIds: Record<string, string> = {};

  for (const event of plan.events) {
    const [row] = await db
      .insert(traceEvents)
      .values({
        tenant_id: input.tenantId,
        trace_run_id: traceRunId,
        parent_event_id: event.parentKey
          ? traceEventIds[event.parentKey]
          : undefined,
        thread_turn_id: input.threadTurnId,
        request_id: event.requestId || undefined,
        parent_request_id: event.parentRequestId || undefined,
        event_type: event.eventType,
        event_status: event.eventStatus || undefined,
        duration_ms: event.durationMs ?? undefined,
        payload_summary: event.payloadSummary,
        source_evidence_ref: event.sourceEvidenceRef ?? {},
        metadata: event.metadata ?? {},
      })
      .returning({ id: traceEvents.id });
    traceEventIds[event.key] = row.id;

    const [source] = await db
      .insert(traceSourceEvidence)
      .values({
        tenant_id: input.tenantId,
        trace_run_id: traceRunId,
        trace_event_id: row.id,
        source_type: "runtime",
        source_system: "thinkwork.chat_finalize",
        source_id: event.requestId ?? event.key,
        summary: event.payloadSummary,
        metadata: {
          event_key: event.key,
          event_type: event.eventType,
          trace_id: plan.traceId,
        },
      })
      .returning({ id: traceSourceEvidence.id });
    sourceEvidenceIds[event.key] = source.id;
  }

  const linkedCostEventIds = await linkCostEventsToTrace({
    tenantId: input.tenantId,
    traceRunId,
    traceEventIds,
    sourceEvidenceIds,
    costLinks: plan.costLinks,
  });

  return {
    traceRunId,
    traceEventIds,
    costEventIds: linkedCostEventIds,
  };
}

async function linkCostEventsToTrace(input: {
  tenantId: string;
  traceRunId: string;
  traceEventIds: Record<string, string>;
  sourceEvidenceIds: Record<string, string>;
  costLinks: TraceEvidenceCostLinkPlan[];
}): Promise<string[]> {
  const requestIds = [
    ...new Set(input.costLinks.map((link) => link.requestId)),
  ];
  if (requestIds.length === 0) return [];

  for (const link of input.costLinks) {
    const traceEventId = input.traceEventIds[link.eventKey];
    if (!traceEventId) continue;
    await db
      .update(costEvents)
      .set({
        trace_event_id: traceEventId,
        reconciliation_state: "runtime-reported",
        reconciliation_source: "runtime",
        reconciliation_at: new Date(),
        source_evidence_ref: {
          source_type: "runtime",
          trace_run_id: input.traceRunId,
          trace_event_id: traceEventId,
          trace_source_evidence_id: input.sourceEvidenceIds[link.eventKey],
        },
        metadata: sql`coalesce(${costEvents.metadata}, '{}'::jsonb) || ${JSON.stringify(
          {
            trace_ledger: {
              trace_run_id: input.traceRunId,
              trace_event_id: traceEventId,
              attribution_level: link.attributionLevel,
              reconciliation_state: "runtime-reported",
            },
          },
        )}::jsonb`,
      })
      .where(
        and(
          eq(costEvents.tenant_id, input.tenantId),
          eq(costEvents.request_id, link.requestId),
          eq(costEvents.event_type, link.eventType),
        ),
      );
  }

  const rows = await db
    .select({
      id: costEvents.id,
      requestId: costEvents.request_id,
      eventType: costEvents.event_type,
      traceEventId: costEvents.trace_event_id,
      provider: costEvents.provider,
      model: costEvents.model,
      inputTokens: costEvents.input_tokens,
      outputTokens: costEvents.output_tokens,
      cachedReadTokens: costEvents.cached_read_tokens,
      amountUsd: costEvents.amount_usd,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.tenant_id, input.tenantId),
        inArray(costEvents.request_id, requestIds),
      ),
    );

  const facts = rows
    .map((row) => {
      const link = input.costLinks.find(
        (candidate) =>
          candidate.requestId === row.requestId &&
          candidate.eventType === row.eventType,
      );
      if (!link || !row.traceEventId) return null;
      return {
        tenant_id: input.tenantId,
        trace_run_id: input.traceRunId,
        trace_event_id: row.traceEventId,
        cost_event_id: row.id,
        source_evidence_id: input.sourceEvidenceIds[link.eventKey],
        reconciliation_state: "runtime-reported",
        reconciliation_scope: "runtime",
        provider: row.provider,
        model: row.model,
        request_id: row.requestId,
        attribution_level: link.attributionLevel,
        runtime_input_tokens: row.inputTokens,
        runtime_output_tokens: row.outputTokens,
        runtime_cached_read_tokens: row.cachedReadTokens,
        runtime_amount_usd: row.amountUsd,
        metadata: {
          event_type: row.eventType,
          source: "trace_ledger_runtime_ingest",
        },
      };
    })
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null);

  if (facts.length > 0) {
    await db.insert(traceCostReconciliationFacts).values(facts);
  }

  return rows.map((row) => row.id);
}

function appendDiagnosticPhaseEvents(
  events: TraceEvidenceEventPlan[],
  input: RuntimeFinalizeEvidenceInput,
): void {
  const phases = arrayValue(input.diagnostics?.agentcore_phases);
  phases.forEach((phase, index) => {
    const record = readRecord(phase);
    events.push({
      key: `runtime-phase-${index}`,
      parentKey: "turn",
      eventType: phaseEventType(record),
      eventStatus: stringValue(record.status) ?? "observed",
      requestId: `${input.threadTurnId}:phase:${index}`,
      durationMs: numberValue(record.duration_ms ?? record.durationMs) ?? null,
      payloadSummary: stripUndefined({
        phase: stringValue(record.phase) ?? `phase-${index}`,
        ...record,
      }),
      sourceEvidenceRef: runtimeSourceRef(input, `runtime-phase-${index}`),
      metadata: { source: "diagnostics.agentcore_phases" },
    });
  });
}

function appendWorkspaceReconcileEvent(
  events: TraceEvidenceEventPlan[],
  input: RuntimeFinalizeEvidenceInput,
): void {
  const workspaceDiagnostics = readRecord(
    input.diagnostics?.workspace_diagnostics,
  );
  const reconcileStatus = stringValue(workspaceDiagnostics.reconcile_status);
  if (!reconcileStatus && !input.reconcile) return;
  events.push({
    key: "workspace-reconcile",
    parentKey: "turn",
    eventType: "workspace_hydration",
    eventStatus: reconcileStatus ?? "observed",
    requestId: `${input.threadTurnId}:workspace-reconcile`,
    durationMs:
      numberValue(workspaceDiagnostics.reconcile_writeback_ms) ?? null,
    payloadSummary: stripUndefined({
      ...workspaceDiagnostics,
      reconcile: summarizeReconcile(input.reconcile),
    }),
    sourceEvidenceRef: runtimeSourceRef(input, "workspace-reconcile"),
    metadata: { source: "workspace_reconcile" },
  });
}

function appendToolEvents(
  events: TraceEvidenceEventPlan[],
  costLinks: TraceEvidenceCostLinkPlan[],
  input: RuntimeFinalizeEvidenceInput,
): void {
  const toolEventKeyById = new Map<string, string>();
  for (const [index, invocation] of (input.toolInvocations ?? []).entries()) {
    const toolCallId = toolCallIdFromInvocation(invocation) ?? `tool-${index}`;
    const toolName = toolNameFromInvocation(invocation) ?? "tool";
    const key = `tool-${toolCallId}`;
    toolEventKeyById.set(toolCallId, key);
    events.push({
      key,
      parentKey: "turn",
      eventType:
        toolName === "query_wiki_context"
          ? "memory_context_lookup"
          : "tool_invocation",
      eventStatus: toolStatus(invocation),
      requestId: `${input.threadTurnId}:tool:${toolCallId}`,
      parentRequestId: input.threadTurnId,
      durationMs: numberValue(invocation.duration_ms) ?? null,
      payloadSummary: stripUndefined({
        tool_call_id: toolCallId,
        tool_name: toolName,
        model: stringValue(invocation.model),
        input_tokens: numberValue(invocation.input_tokens),
        output_tokens: numberValue(invocation.output_tokens),
        cached_read_tokens: numberValue(invocation.cached_read_tokens),
        cost_usd: numberValue(invocation.cost_usd),
        model_routing_status: stringValue(invocation.model_routing_status),
        is_error: Boolean(invocation.is_error),
      }),
      sourceEvidenceRef: runtimeSourceRef(input, key),
      metadata: { source: "runtime.tool_invocations" },
    });
  }

  for (const call of input.modelRoutedToolCalls ?? []) {
    const parentKey = toolEventKeyById.get(call.toolCallId) ?? "turn";
    const key = `routed-model-${call.toolCallId}`;
    const requestId = `${input.threadTurnId}:tool:${call.toolCallId}:model`;
    events.push({
      key,
      parentKey,
      eventType: "model_invocation",
      eventStatus: call.status,
      requestId,
      parentRequestId: input.threadTurnId,
      durationMs: call.durationMs,
      payloadSummary: stripUndefined({
        tool_call_id: call.toolCallId,
        tool_name: call.toolName,
        model: call.model,
        input_tokens: call.inputTokens,
        output_tokens: call.outputTokens,
        cached_read_tokens: call.cachedReadTokens,
        cost_usd: call.costUsd,
        status: call.status,
        error: call.error,
        match: call.match,
        rule_source: call.ruleSource,
      }),
      sourceEvidenceRef: runtimeSourceRef(input, key),
      metadata: { attribution_level: "model_routed_tool" },
    });
    costLinks.push({
      eventKey: key,
      requestId,
      eventType: "llm",
      attributionLevel: "model_routed_tool",
    });
  }
}

function appendProfileEvents(
  events: TraceEvidenceEventPlan[],
  costLinks: TraceEvidenceCostLinkPlan[],
  input: RuntimeFinalizeEvidenceInput,
): void {
  for (const run of input.agentProfileRuns ?? []) {
    const key = `profile-${run.profileRunId}`;
    const requestId = `${input.threadTurnId}:profile:${run.profileRunId}:model`;
    events.push({
      key,
      parentKey: "turn",
      eventType: "agent_profile_run",
      eventStatus: run.status,
      requestId,
      parentRequestId: input.threadTurnId,
      durationMs: run.durationMs,
      payloadSummary: stripUndefined({
        profile_run_id: run.profileRunId,
        profile_id: run.profileId,
        profile_slug: run.profileSlug,
        profile_name: run.profileName,
        lane_key: run.laneKey,
        model: run.model,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        cached_read_tokens: run.cachedReadTokens,
        cost_usd: run.costUsd,
        status: run.status,
        error: run.error,
      }),
      sourceEvidenceRef: runtimeSourceRef(input, key),
      metadata: { attribution_level: "agent_profile_run" },
    });
    costLinks.push({
      eventKey: key,
      requestId,
      eventType: "llm",
      attributionLevel: "agent_profile_run",
    });
  }
}

function hasTokenOrCostEvidence(usage: RuntimeUsageEvidence): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cachedReadTokens > 0 ||
    typeof usage.costUsd === "number"
  );
}

function phaseEventType(record: JsonRecord): TraceEventType {
  const phase = stringValue(record.phase)?.toLowerCase() ?? "";
  if (phase.includes("workspace")) return "workspace_hydration";
  if (phase.includes("memory") || phase.includes("context")) {
    return "memory_context_lookup";
  }
  return "runtime_phase";
}

function runtimeSourceRef(
  input: RuntimeFinalizeEvidenceInput,
  eventKey: string,
): JsonRecord {
  return stripUndefined({
    source_type: "runtime",
    source_system: "thinkwork.chat_finalize",
    trace_id: input.traceId ?? input.threadTurnId,
    thread_turn_id: input.threadTurnId,
    event_key: eventKey,
  });
}

function summarizeReconcile(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as JsonRecord;
  const files = Array.isArray(record.files) ? record.files : [];
  return stripUndefined({
    status: record.status,
    file_count: files.length,
  });
}

function toolCallIdFromInvocation(
  invocation: RuntimeToolInvocationEvidence,
): string | null {
  return (
    stringValue(invocation.id) ??
    stringValue(invocation.tool_call_id) ??
    stringValue(invocation.toolCallId) ??
    null
  );
}

function toolNameFromInvocation(
  invocation: RuntimeToolInvocationEvidence,
): string | null {
  return (
    stringValue(invocation.tool_name) ??
    stringValue(invocation.toolName) ??
    stringValue(invocation.name) ??
    null
  );
}

function toolStatus(invocation: RuntimeToolInvocationEvidence): string {
  if (stringValue(invocation.status)) return stringValue(invocation.status)!;
  return invocation.is_error ? "failed" : "completed";
}

function readRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stripUndefined<T extends JsonRecord>(record: T): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
