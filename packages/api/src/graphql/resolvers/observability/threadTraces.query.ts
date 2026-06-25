/**
 * PRD-20: Query canonical trace ledger events associated with a thread.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, sql, agents } from "../../utils.js";
import { traceEvents, traceRuns } from "@thinkwork/database-pg/schema";

type JsonRecord = Record<string, unknown>;

type SourceEvidenceView = {
  id: string;
  traceRunId: string | null;
  traceEventId: string | null;
  sourceType: string;
  sourceSystem: string;
  sourceId: string | null;
  uri: string | null;
  observedAt: string | Date | null;
  summary: JsonRecord;
  redactionState: string;
  retentionExpiresAt: string | Date | null;
  metadata: JsonRecord;
  createdAt: string | Date;
};

export const threadTraces = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const rows = await db
    .select({
      traceId: traceRuns.trace_id,
      requestId: traceEvents.request_id,
      parentRequestId: traceEvents.parent_request_id,
      eventType: traceEvents.event_type,
      eventStatus: traceEvents.event_status,
      threadId: traceRuns.thread_id,
      threadTurnId: traceEvents.thread_turn_id,
      agentId: traceRuns.agent_id,
      agentName: agents.name,
      runtimeType: traceRuns.runtime_type,
      durationMs: traceEvents.duration_ms,
      payloadSummary: traceEvents.payload_summary,
      sourceEvidenceRef: traceEvents.source_evidence_ref,
      metadata: traceEvents.metadata,
      observedAt: traceEvents.observed_at,
      createdAt: traceEvents.created_at,
      costEventModel: sql<string | null>`(
        SELECT ce.model
        FROM cost_events ce
        WHERE ce.trace_event_id = ${traceEvents.id}
        ORDER BY ce.created_at DESC
        LIMIT 1
      )`,
      costEventInputTokens: sql<number | null>`(
        SELECT ce.input_tokens
        FROM cost_events ce
        WHERE ce.trace_event_id = ${traceEvents.id}
        ORDER BY ce.created_at DESC
        LIMIT 1
      )`,
      costEventOutputTokens: sql<number | null>`(
        SELECT ce.output_tokens
        FROM cost_events ce
        WHERE ce.trace_event_id = ${traceEvents.id}
        ORDER BY ce.created_at DESC
        LIMIT 1
      )`,
      costEventAmountUsd: sql<number | null>`(
        SELECT ce.amount_usd::float
        FROM cost_events ce
        WHERE ce.trace_event_id = ${traceEvents.id}
        ORDER BY ce.created_at DESC
        LIMIT 1
      )`,
      costEventReconciliationState: sql<string | null>`(
        SELECT ce.reconciliation_state
        FROM cost_events ce
        WHERE ce.trace_event_id = ${traceEvents.id}
        ORDER BY ce.reconciliation_at DESC NULLS LAST, ce.created_at DESC
        LIMIT 1
      )`,
      reconciliationState: sql<string | null>`(
        SELECT f.reconciliation_state
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id}
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      reconciliationSource: sql<string | null>`(
        SELECT f.reconciliation_scope
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id}
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      factModel: sql<string | null>`(
        SELECT f.model
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id} AND f.model IS NOT NULL
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      factInputTokens: sql<number | null>`(
        SELECT COALESCE(f.provider_input_tokens, f.runtime_input_tokens)
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id}
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      factOutputTokens: sql<number | null>`(
        SELECT COALESCE(f.provider_output_tokens, f.runtime_output_tokens)
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id}
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      factAmountUsd: sql<number | null>`(
        SELECT COALESCE(f.billed_amount_usd, f.provider_amount_usd, f.runtime_amount_usd)::float
        FROM trace_cost_reconciliation_facts f
        WHERE f.trace_event_id = ${traceEvents.id}
        ORDER BY f.reconciled_at DESC, f.id DESC
        LIMIT 1
      )`,
      sourceEvidence: sql<SourceEvidenceView[]>`COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', se.id,
              'traceRunId', se.trace_run_id,
              'traceEventId', se.trace_event_id,
              'sourceType', se.source_type,
              'sourceSystem', se.source_system,
              'sourceId', se.source_id,
              'uri', se.uri,
              'observedAt', se.observed_at,
              'summary', se.summary,
              'redactionState', se.redaction_state,
              'retentionExpiresAt', se.retention_expires_at,
              'metadata', se.metadata,
              'createdAt', se.created_at
            )
            ORDER BY se.created_at
          )
          FROM trace_source_evidence se
          WHERE se.trace_event_id = ${traceEvents.id}
        ),
        '[]'::jsonb
      )`,
    })
    .from(traceEvents)
    .innerJoin(traceRuns, eq(traceEvents.trace_run_id, traceRuns.id))
    .leftJoin(agents, eq(traceRuns.agent_id, agents.id))
    .where(
      and(
        eq(traceRuns.thread_id, args.threadId),
        eq(traceRuns.tenant_id, args.tenantId),
      ),
    )
    .orderBy(sql`${traceEvents.observed_at} DESC`)
    .limit(100);

  return rows.map((row) => mapTraceRow(row));
};

function mapTraceRow(row: Record<string, unknown>) {
  const metadata = asRecord(row.metadata);
  const payload = asRecord(row.payloadSummary);
  const sourceEvidence = Array.isArray(row.sourceEvidence)
    ? row.sourceEvidence.map((evidence) =>
        mapSourceEvidence(evidence as SourceEvidenceView),
      )
    : [];

  return {
    traceId: row.traceId,
    requestId: row.requestId,
    eventType: row.eventType,
    threadId: row.threadId,
    threadTurnId: row.threadTurnId,
    agentId: row.agentId,
    agentName: row.agentName,
    runtimeType: row.runtimeType,
    model:
      stringValue(payload.model) ??
      stringValue(row.factModel) ??
      stringValue(row.costEventModel) ??
      stringValue(metadata.model),
    inputTokens:
      numberValue(payload.input_tokens) ??
      numberValue(row.factInputTokens) ??
      numberValue(row.costEventInputTokens),
    outputTokens:
      numberValue(payload.output_tokens) ??
      numberValue(row.factOutputTokens) ??
      numberValue(row.costEventOutputTokens),
    durationMs: row.durationMs,
    costUsd:
      numberValue(payload.cost_usd) ??
      numberValue(row.factAmountUsd) ??
      numberValue(row.costEventAmountUsd),
    estimated: metadata.estimated === true,
    source:
      stringValue(metadata.source) ??
      sourceEvidence[0]?.sourceType ??
      stringValue(asRecord(row.sourceEvidenceRef).source_type),
    parentRequestId:
      stringValue(row.parentRequestId) ??
      stringValue(metadata.parent_request_id),
    toolCallId:
      stringValue(payload.tool_call_id) ?? stringValue(metadata.tool_call_id),
    toolName:
      stringValue(payload.tool_name) ??
      stringValue(payload.name) ??
      stringValue(metadata.tool_name),
    profileRunId: stringValue(metadata.profile_run_id),
    profileId: stringValue(metadata.profile_id),
    profileSlug: stringValue(metadata.profile_slug),
    profileName: stringValue(metadata.profile_name),
    laneKey: stringValue(metadata.lane_key),
    profileStatus:
      stringValue(metadata.profile_status) ?? stringValue(row.eventStatus),
    loopId: stringValue(metadata.loop_id),
    loopOwnerType: stringValue(metadata.loop_owner_type),
    loopOwnerSlug: stringValue(metadata.loop_owner_slug),
    loopIterationIndex: numberValue(metadata.loop_iteration_index),
    loopPhase: stringValue(metadata.loop_phase),
    loopStatus: stringValue(metadata.loop_status),
    loopVerdict: stringValue(metadata.loop_verdict),
    reviewerRole: metadata.reviewer_role === true,
    loopEvidence: metadata.loop_evidence ?? null,
    modelRoutingStatus:
      stringValue(metadata.model_routing_status) ??
      stringValue(row.eventStatus),
    reconciliationState:
      stringValue(row.reconciliationState) ??
      stringValue(row.costEventReconciliationState),
    reconciliationSource: stringValue(row.reconciliationSource),
    sourceEvidence,
    ruleSource: metadata.rule_source ?? null,
    match: metadata.match ?? null,
    metadata,
    createdAt: dateValue(row.createdAt) ?? dateValue(row.observedAt),
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function mapSourceEvidence(row: SourceEvidenceView): SourceEvidenceView {
  return {
    ...row,
    observedAt: dateValue(row.observedAt),
    retentionExpiresAt: dateValue(row.retentionExpiresAt),
    createdAt: dateValue(row.createdAt) ?? new Date(0).toISOString(),
    summary: asRecord(row.summary),
    metadata: asRecord(row.metadata),
  };
}
