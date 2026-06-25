import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import { getDb } from "@thinkwork/database-pg";
import {
  costEvents,
  threadTurns,
  traceCostReconciliationFacts,
  traceEvents,
  traceRuns,
  traceSourceEvidence,
} from "@thinkwork/database-pg/schema";

export interface CloudWatchLogsClientLike {
  send(command: FilterLogEventsCommand): Promise<FilterLogEventsCommandOutput>;
}

export interface CloudWatchLogEventLike {
  eventId?: string;
  logStreamName?: string;
  message?: string;
  timestamp?: number;
}

export interface BedrockInvocationLogRecord {
  requestId: string;
  operation: string | null;
  modelId: string;
  displayModelId: string;
  timestamp: string;
  inputTokenCount: number;
  outputTokenCount: number;
  cacheReadTokenCount: number;
  cacheWriteTokenCount: number;
  durationMs: number | null;
  errorState: string | null;
  inputPreview: string;
  outputPreview: string;
  toolCount: number;
  costUsd: number;
  toolUses: string[];
  hasToolResult: boolean;
  branch: string;
  requestMetadata: Record<string, string>;
  source: {
    logGroupName: string;
    logStreamName?: string;
    eventId?: string;
    timestamp?: number;
  };
}

export interface RuntimeModelUsageObservation {
  traceRunId: string;
  traceEventId: string;
  costEventId?: string | null;
  requestId: string | null;
  model: string | null;
  provider: string | null;
  attributionLevel?: string | null;
  runtimeInputTokens: number;
  runtimeOutputTokens: number;
  runtimeCachedReadTokens: number;
  runtimeAmountUsd: number | null;
  durationMs?: number | null;
  observedAt?: Date | null;
  bedrockRequestIds?: string[];
  traceId?: string | null;
  threadTurnId?: string | null;
}

export type InvocationReconciliationState =
  | "invocation-reconciled"
  | "mismatch"
  | "unreconciled/error";

export interface InvocationReconciliationDecision {
  runtime: RuntimeModelUsageObservation;
  provider?: BedrockInvocationLogRecord;
  state: InvocationReconciliationState;
  confidence: "request-id" | "request-metadata" | "model-time" | "none";
  reason:
    | "request-id-match"
    | "request-metadata-match"
    | "single-model-time-match"
    | "provider-token-mismatch"
    | "no-provider-log"
    | "ambiguous-provider-logs";
  candidateRequestIds: string[];
  tokenVariance: {
    input: number;
    output: number;
    cachedRead: number;
  };
  amountVarianceUsd: number | null;
}

export interface BedrockInvocationReconciliationResult {
  tenantId: string;
  turnId: string;
  matched: number;
  mismatched: number;
  unreconciled: number;
  decisions: InvocationReconciliationDecision[];
}

type RankedProviderCandidate = {
  record: BedrockInvocationLogRecord;
  score: number;
  confidence: InvocationReconciliationDecision["confidence"];
  reason: InvocationReconciliationDecision["reason"];
};

export interface ModelInvocationLogView {
  requestId: string;
  modelId: string;
  timestamp: string;
  inputTokenCount: number;
  outputTokenCount: number;
  cacheReadTokenCount: number;
  cacheWriteTokenCount: number;
  inputPreview: string;
  outputPreview: string;
  toolCount: number;
  costUsd: number;
  toolUses: string[];
  hasToolResult: boolean;
  branch: string;
  reconciliationState?: InvocationReconciliationState;
  reconciliationReason?: string;
  reconciliationConfidence?: string;
  reconciliationRuntimeRequestId?: string | null;
  reconciliationDiagnostic?: string;
}

const REGION = process.env.AWS_REGION || "us-east-1";
export const DEFAULT_BEDROCK_INVOCATION_LOG_GROUP =
  process.env.BEDROCK_INVOCATION_LOG_GROUP ||
  "/thinkwork/bedrock/model-invocations";

const defaultCloudWatch = new CloudWatchLogsClient({ region: REGION });

// Fallback pricing for near-real-time log-derived estimates (per million tokens).
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "kimi-k2": { input: 1.0, output: 3.0 },
};

export function normalizeInvocationTimestamp(
  value: unknown,
  fallbackMs: number | undefined,
): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const epochMs = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(epochMs).toISOString();
  }

  if (fallbackMs && Number.isFinite(fallbackMs) && fallbackMs > 0) {
    return new Date(fallbackMs).toISOString();
  }

  return new Date(0).toISOString();
}

export function parseBedrockInvocationLogEvent(
  event: CloudWatchLogEventLike,
  logGroupName = DEFAULT_BEDROCK_INVOCATION_LOG_GROUP,
): BedrockInvocationLogRecord | null {
  try {
    const log = parseJsonObject(event.message);
    if (!log) return null;
    const input = readRecord(log.input);
    const output = readRecord(log.output);
    const modelId = stringValue(log.modelId) ?? "";
    const pricing = lookupPricing(modelId);

    const inputTokens = nonNegativeInt(input.inputTokenCount);
    const outputTokens = nonNegativeInt(output.outputTokenCount);
    const cacheReadTokens = nonNegativeInt(input.cacheReadInputTokenCount);
    const cacheWriteTokens = nonNegativeInt(input.cacheWriteInputTokenCount);
    const costUsd =
      (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

    const inputBodyJson = input.inputBodyJson;
    const outputBodyJson = output.outputBodyJson;
    const outputContent = readArray(
      readRecord(readRecord(outputBodyJson).output).message
        ? readRecord(readRecord(readRecord(outputBodyJson).output).message)
            .content
        : readRecord(outputBodyJson).content,
    );
    const toolUses = outputContent.flatMap((block) => {
      const record = readRecord(block);
      const toolUse = readRecord(record.toolUse);
      const name = stringValue(toolUse.name) ?? stringValue(record.name);
      return name ? [name] : [];
    });
    const inputMessages = readArray(readRecord(inputBodyJson).messages);
    const hasToolResult = inputMessages.some((message) =>
      readArray(readRecord(message).content).some((block) =>
        Boolean(readRecord(block).toolResult),
      ),
    );
    const systemText = extractSystemText(readRecord(inputBodyJson).system);
    const branch = inferInvocationBranch(systemText);

    return {
      requestId: stringValue(log.requestId) ?? "",
      operation: stringValue(log.operation),
      modelId,
      displayModelId: shortenModelId(modelId),
      timestamp: normalizeInvocationTimestamp(log.timestamp, event.timestamp),
      inputTokenCount: inputTokens,
      outputTokenCount: outputTokens,
      cacheReadTokenCount: cacheReadTokens,
      cacheWriteTokenCount: cacheWriteTokens,
      durationMs: numberValue(log.latencyMs ?? log.durationMs),
      errorState:
        stringValue(log.errorCode) ??
        stringValue(log.error) ??
        stringValue(log.status),
      inputPreview: extractInputPreview(inputBodyJson),
      outputPreview: extractOutputPreview(outputBodyJson),
      toolCount: readArray(
        readRecord(readRecord(inputBodyJson).toolConfig).tools,
      ).length,
      costUsd: roundUsd(costUsd),
      toolUses,
      hasToolResult,
      branch,
      requestMetadata: stringMap(log.requestMetadata),
      source: {
        logGroupName,
        logStreamName: event.logStreamName,
        eventId: event.eventId,
        timestamp: event.timestamp,
      },
    };
  } catch {
    return null;
  }
}

export function reconcileInvocationRecords(
  runtimeObservations: RuntimeModelUsageObservation[],
  providerRecords: BedrockInvocationLogRecord[],
): InvocationReconciliationDecision[] {
  return runtimeObservations.map((runtime) => {
    const candidates = rankedCandidates(runtime, providerRecords);
    if (candidates.length === 0) {
      return decision(runtime, undefined, "unreconciled/error", "none", {
        reason: "no-provider-log",
        candidates: [],
      });
    }

    const topScore = candidates[0].score;
    const top = candidates.filter((candidate) => candidate.score === topScore);
    if (top.length !== 1) {
      return decision(runtime, undefined, "unreconciled/error", "none", {
        reason: "ambiguous-provider-logs",
        candidates: top.map((candidate) => candidate.record),
      });
    }

    const match = top[0];
    const state = hasTokenMismatch(runtime, match.record)
      ? "mismatch"
      : "invocation-reconciled";
    return decision(runtime, match.record, state, match.confidence, {
      reason: state === "mismatch" ? "provider-token-mismatch" : match.reason,
      candidates: [match.record],
    });
  });
}

export function modelInvocationLogView(
  record: BedrockInvocationLogRecord,
  decisions: InvocationReconciliationDecision[] = [],
): ModelInvocationLogView {
  const decision = decisions.find(
    (candidate) => candidate.provider?.requestId === record.requestId,
  );
  return {
    requestId: record.requestId,
    modelId: record.displayModelId,
    timestamp: record.timestamp,
    inputTokenCount: record.inputTokenCount,
    outputTokenCount: record.outputTokenCount,
    cacheReadTokenCount: record.cacheReadTokenCount,
    cacheWriteTokenCount: record.cacheWriteTokenCount,
    inputPreview: record.inputPreview,
    outputPreview: record.outputPreview,
    toolCount: record.toolCount,
    costUsd: record.costUsd,
    toolUses: record.toolUses,
    hasToolResult: record.hasToolResult,
    branch: record.branch,
    reconciliationState: decision?.state,
    reconciliationReason: decision?.reason,
    reconciliationConfidence: decision?.confidence,
    reconciliationRuntimeRequestId: decision?.runtime.requestId,
    reconciliationDiagnostic: decisionDiagnostic(decision),
  };
}

export async function fetchBedrockInvocationLogsForWindow(input: {
  startMs: number;
  endMs: number;
  cloudWatch?: CloudWatchLogsClientLike;
  logGroupName?: string;
  limit?: number;
}): Promise<BedrockInvocationLogRecord[]> {
  const cloudWatch =
    input.cloudWatch ?? (defaultCloudWatch as CloudWatchLogsClientLike);
  const logGroupName =
    input.logGroupName ?? DEFAULT_BEDROCK_INVOCATION_LOG_GROUP;
  const response = await cloudWatch.send(
    new FilterLogEventsCommand({
      logGroupName,
      startTime: input.startMs,
      endTime: input.endMs,
      limit: input.limit ?? 20,
    }),
  );
  return (response.events ?? []).flatMap((event) => {
    const record = parseBedrockInvocationLogEvent(event, logGroupName);
    return record ? [record] : [];
  });
}

export async function loadTurnInvocationReconciliationInput(
  tenantId: string,
  turnId: string,
): Promise<{
  window: { startMs: number; endMs: number } | null;
  runtimeObservations: RuntimeModelUsageObservation[];
}> {
  const db = getDb();
  const [turn] = await db
    .select({
      startedAt: threadTurns.started_at,
      finishedAt: threadTurns.finished_at,
      createdAt: threadTurns.created_at,
    })
    .from(threadTurns)
    .where(and(eq(threadTurns.id, turnId), eq(threadTurns.tenant_id, tenantId)))
    .limit(1);

  if (!turn) return { window: null, runtimeObservations: [] };
  const startTime = turn.startedAt || turn.createdAt;
  const endTime = turn.finishedAt || new Date();
  if (!startTime) return { window: null, runtimeObservations: [] };

  return {
    window: {
      startMs: startTime.getTime() - 1000,
      endMs: endTime.getTime() + 5000,
    },
    runtimeObservations: await loadRuntimeModelObservations(tenantId, turnId),
  };
}

export async function reconcileBedrockInvocationsForTurn(input: {
  tenantId: string;
  turnId: string;
  cloudWatch?: CloudWatchLogsClientLike;
  logGroupName?: string;
}): Promise<BedrockInvocationReconciliationResult> {
  const loaded = await loadTurnInvocationReconciliationInput(
    input.tenantId,
    input.turnId,
  );
  if (!loaded.window) {
    return {
      tenantId: input.tenantId,
      turnId: input.turnId,
      matched: 0,
      mismatched: 0,
      unreconciled: 0,
      decisions: [],
    };
  }

  const providerRecords = await fetchBedrockInvocationLogsForWindow({
    ...loaded.window,
    cloudWatch: input.cloudWatch,
    logGroupName: input.logGroupName,
    limit: 100,
  });
  const decisions = reconcileInvocationRecords(
    loaded.runtimeObservations,
    providerRecords,
  );
  await persistReconciliationDecisions(input.tenantId, decisions);
  return summarizeResult(input.tenantId, input.turnId, decisions);
}

export async function reconcileRecentBedrockInvocations(
  input: {
    limit?: number;
    lookbackMinutes?: number;
    cloudWatch?: CloudWatchLogsClientLike;
    logGroupName?: string;
  } = {},
): Promise<{
  turnsScanned: number;
  matched: number;
  mismatched: number;
  unreconciled: number;
}> {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - (input.lookbackMinutes ?? 180) * 60 * 1000,
  );
  const rows = await db
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
        sql`${costEvents.created_at} >= ${cutoff}`,
        sql`${traceEvents.thread_turn_id} IS NOT NULL`,
      ),
    )
    .orderBy(desc(costEvents.created_at))
    .limit(input.limit ?? 50);

  const uniqueTurns = [
    ...new Map(
      rows
        .filter((row) => row.turnId)
        .map((row) => [`${row.tenantId}:${row.turnId}`, row]),
    ).values(),
  ];

  let matched = 0;
  let mismatched = 0;
  let unreconciled = 0;
  for (const row of uniqueTurns) {
    const result = await reconcileBedrockInvocationsForTurn({
      tenantId: row.tenantId,
      turnId: row.turnId!,
      cloudWatch: input.cloudWatch,
      logGroupName: input.logGroupName,
    });
    matched += result.matched;
    mismatched += result.mismatched;
    unreconciled += result.unreconciled;
  }

  return {
    turnsScanned: uniqueTurns.length,
    matched,
    mismatched,
    unreconciled,
  };
}

async function loadRuntimeModelObservations(
  tenantId: string,
  turnId: string,
): Promise<RuntimeModelUsageObservation[]> {
  const db = getDb();
  const rows = await db
    .select({
      traceRunId: traceRuns.id,
      traceId: traceRuns.trace_id,
      threadTurnId: traceRuns.thread_turn_id,
      traceEventId: traceEvents.id,
      requestId: traceEvents.request_id,
      durationMs: traceEvents.duration_ms,
      observedAt: traceEvents.observed_at,
      payloadSummary: traceEvents.payload_summary,
      metadata: traceEvents.metadata,
      costEventId: costEvents.id,
      provider: costEvents.provider,
      model: costEvents.model,
      inputTokens: costEvents.input_tokens,
      outputTokens: costEvents.output_tokens,
      cachedReadTokens: costEvents.cached_read_tokens,
      amountUsd: costEvents.amount_usd,
    })
    .from(traceRuns)
    .innerJoin(traceEvents, eq(traceEvents.trace_run_id, traceRuns.id))
    .leftJoin(costEvents, eq(costEvents.trace_event_id, traceEvents.id))
    .where(
      and(
        eq(traceRuns.tenant_id, tenantId),
        eq(traceRuns.thread_turn_id, turnId),
        eq(traceEvents.event_type, "model_invocation"),
      ),
    );

  return rows.map((row) => {
    const payload = row.payloadSummary ?? {};
    const metadata = row.metadata ?? {};
    return {
      traceRunId: row.traceRunId,
      traceEventId: row.traceEventId,
      costEventId: row.costEventId,
      requestId: row.requestId,
      model: row.model ?? stringValue(payload.model),
      provider: row.provider ?? "bedrock",
      attributionLevel: stringValue(metadata.attribution_level),
      runtimeInputTokens: nonNegativeInt(
        row.inputTokens ?? payload.input_tokens,
      ),
      runtimeOutputTokens: nonNegativeInt(
        row.outputTokens ?? payload.output_tokens,
      ),
      runtimeCachedReadTokens: nonNegativeInt(
        row.cachedReadTokens ?? payload.cached_read_tokens,
      ),
      runtimeAmountUsd: numberValue(row.amountUsd ?? payload.cost_usd),
      durationMs: row.durationMs,
      observedAt: row.observedAt,
      bedrockRequestIds: stringArray(payload.bedrock_request_ids),
      traceId: row.traceId,
      threadTurnId: row.threadTurnId,
    };
  });
}

async function persistReconciliationDecisions(
  tenantId: string,
  decisions: InvocationReconciliationDecision[],
): Promise<void> {
  for (const decision of decisions) {
    if (!decision.provider) {
      await appendReconciliationFact(tenantId, decision, null);
      continue;
    }

    const sourceEvidenceId = await getOrCreateSourceEvidence(
      tenantId,
      decision,
    );
    await appendReconciliationFact(tenantId, decision, sourceEvidenceId);
    await updateCostEventCurrentState(tenantId, decision, sourceEvidenceId);
  }
}

async function getOrCreateSourceEvidence(
  tenantId: string,
  decision: InvocationReconciliationDecision,
): Promise<string> {
  const db = getDb();
  const provider = decision.provider!;
  const sourceId = provider.requestId || provider.source.eventId || "unknown";
  const [existing] = await db
    .select({ id: traceSourceEvidence.id })
    .from(traceSourceEvidence)
    .where(
      and(
        eq(traceSourceEvidence.tenant_id, tenantId),
        eq(traceSourceEvidence.source_type, "bedrock_invocation_log"),
        eq(traceSourceEvidence.source_id, sourceId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(traceSourceEvidence)
    .values({
      tenant_id: tenantId,
      trace_run_id: decision.runtime.traceRunId,
      trace_event_id: decision.runtime.traceEventId,
      source_type: "bedrock_invocation_log",
      source_system: "aws.bedrock.model_invocation_logging",
      source_id: sourceId,
      uri: provider.source.logStreamName
        ? `cloudwatch://${provider.source.logGroupName}/${provider.source.logStreamName}`
        : `cloudwatch://${provider.source.logGroupName}`,
      observed_at: new Date(provider.timestamp),
      summary: providerSummary(provider),
      metadata: {
        event_id: provider.source.eventId,
        log_group_name: provider.source.logGroupName,
        log_stream_name: provider.source.logStreamName,
        request_metadata: provider.requestMetadata,
      },
    })
    .returning({ id: traceSourceEvidence.id });
  return inserted.id;
}

async function appendReconciliationFact(
  tenantId: string,
  decision: InvocationReconciliationDecision,
  sourceEvidenceId: string | null,
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: traceCostReconciliationFacts.id })
    .from(traceCostReconciliationFacts)
    .where(
      and(
        eq(traceCostReconciliationFacts.tenant_id, tenantId),
        eq(
          traceCostReconciliationFacts.trace_event_id,
          decision.runtime.traceEventId,
        ),
        eq(traceCostReconciliationFacts.reconciliation_scope, "invocation"),
        eq(traceCostReconciliationFacts.reconciliation_state, decision.state),
        sourceEvidenceId
          ? eq(
              traceCostReconciliationFacts.source_evidence_id,
              sourceEvidenceId,
            )
          : sql`${traceCostReconciliationFacts.source_evidence_id} IS NULL`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(traceCostReconciliationFacts).values({
    tenant_id: tenantId,
    trace_run_id: decision.runtime.traceRunId,
    trace_event_id: decision.runtime.traceEventId,
    cost_event_id: decision.runtime.costEventId || undefined,
    source_evidence_id: sourceEvidenceId || undefined,
    reconciliation_state: decision.state,
    reconciliation_scope: "invocation",
    provider: decision.runtime.provider ?? "bedrock",
    model: decision.provider?.displayModelId ?? decision.runtime.model,
    request_id: decision.provider?.requestId ?? decision.runtime.requestId,
    attribution_level: decision.runtime.attributionLevel,
    runtime_input_tokens: decision.runtime.runtimeInputTokens,
    runtime_output_tokens: decision.runtime.runtimeOutputTokens,
    runtime_cached_read_tokens: decision.runtime.runtimeCachedReadTokens,
    provider_input_tokens: decision.provider?.inputTokenCount,
    provider_output_tokens: decision.provider?.outputTokenCount,
    provider_cached_read_tokens: decision.provider?.cacheReadTokenCount,
    runtime_amount_usd:
      decision.runtime.runtimeAmountUsd === null
        ? undefined
        : String(decision.runtime.runtimeAmountUsd),
    provider_amount_usd:
      decision.provider?.costUsd === undefined
        ? undefined
        : String(decision.provider.costUsd),
    variance_usd:
      decision.amountVarianceUsd === null
        ? undefined
        : String(decision.amountVarianceUsd),
    metadata: {
      reason: decision.reason,
      confidence: decision.confidence,
      candidate_request_ids: decision.candidateRequestIds,
      provider_cache_write_tokens: decision.provider?.cacheWriteTokenCount,
      provider_operation: decision.provider?.operation,
      provider_error_state: decision.provider?.errorState,
      source: "bedrock_invocation_reconciler",
    },
  });
}

async function updateCostEventCurrentState(
  tenantId: string,
  decision: InvocationReconciliationDecision,
  sourceEvidenceId: string,
): Promise<void> {
  if (!decision.runtime.costEventId || !decision.provider) return;
  const db = getDb();
  await db
    .update(costEvents)
    .set({
      input_tokens: decision.provider.inputTokenCount,
      output_tokens: decision.provider.outputTokenCount,
      cached_read_tokens: decision.provider.cacheReadTokenCount,
      amount_usd: String(decision.provider.costUsd),
      provider: decision.runtime.provider ?? "bedrock",
      model: decision.provider.displayModelId,
      reconciliation_state: decision.state,
      reconciliation_source: "bedrock_invocation_log",
      reconciliation_at: new Date(),
      source_evidence_ref: {
        source_type: "bedrock_invocation_log",
        trace_run_id: decision.runtime.traceRunId,
        trace_event_id: decision.runtime.traceEventId,
        trace_source_evidence_id: sourceEvidenceId,
        provider_request_id: decision.provider.requestId,
      },
      metadata: sql`coalesce(${costEvents.metadata}, '{}'::jsonb) || ${JSON.stringify(
        {
          bedrock_invocation_reconciliation: {
            state: decision.state,
            reason: decision.reason,
            confidence: decision.confidence,
            provider_request_id: decision.provider.requestId,
            provider_cache_write_tokens: decision.provider.cacheWriteTokenCount,
          },
        },
      )}::jsonb`,
    })
    .where(
      and(
        eq(costEvents.tenant_id, tenantId),
        eq(costEvents.id, decision.runtime.costEventId),
      ),
    );
}

function rankedCandidates(
  runtime: RuntimeModelUsageObservation,
  records: BedrockInvocationLogRecord[],
): RankedProviderCandidate[] {
  const candidates: RankedProviderCandidate[] = [];
  for (const record of records) {
    if (runtime.bedrockRequestIds?.includes(record.requestId)) {
      candidates.push({
        record,
        score: 100,
        confidence: "request-id",
        reason: "request-id-match",
      });
      continue;
    }
    if (runtime.requestId && runtime.requestId === record.requestId) {
      candidates.push({
        record,
        score: 100,
        confidence: "request-id",
        reason: "request-id-match",
      });
      continue;
    }
    if (metadataMatchesRuntime(runtime, record)) {
      candidates.push({
        record,
        score: 90,
        confidence: "request-metadata",
        reason: "request-metadata-match",
      });
      continue;
    }
    if (modelsCompatible(runtime.model, record.modelId)) {
      candidates.push({
        record,
        score: 50,
        confidence: "model-time",
        reason: "single-model-time-match",
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function decision(
  runtime: RuntimeModelUsageObservation,
  provider: BedrockInvocationLogRecord | undefined,
  state: InvocationReconciliationState,
  confidence: InvocationReconciliationDecision["confidence"],
  details: {
    reason: InvocationReconciliationDecision["reason"];
    candidates: BedrockInvocationLogRecord[];
  },
): InvocationReconciliationDecision {
  const variance = provider
    ? {
        input: provider.inputTokenCount - runtime.runtimeInputTokens,
        output: provider.outputTokenCount - runtime.runtimeOutputTokens,
        cachedRead:
          provider.cacheReadTokenCount - runtime.runtimeCachedReadTokens,
      }
    : { input: 0, output: 0, cachedRead: 0 };
  return {
    runtime,
    provider,
    state,
    confidence,
    reason: details.reason,
    candidateRequestIds: details.candidates.map(
      (candidate) => candidate.requestId,
    ),
    tokenVariance: variance,
    amountVarianceUsd:
      provider && runtime.runtimeAmountUsd !== null
        ? roundUsd(provider.costUsd - runtime.runtimeAmountUsd)
        : null,
  };
}

function hasTokenMismatch(
  runtime: RuntimeModelUsageObservation,
  provider: BedrockInvocationLogRecord,
): boolean {
  return (
    runtime.runtimeInputTokens !== provider.inputTokenCount ||
    runtime.runtimeOutputTokens !== provider.outputTokenCount ||
    runtime.runtimeCachedReadTokens !== provider.cacheReadTokenCount
  );
}

function summarizeResult(
  tenantId: string,
  turnId: string,
  decisions: InvocationReconciliationDecision[],
): BedrockInvocationReconciliationResult {
  return {
    tenantId,
    turnId,
    matched: decisions.filter(
      (decision) => decision.state === "invocation-reconciled",
    ).length,
    mismatched: decisions.filter((decision) => decision.state === "mismatch")
      .length,
    unreconciled: decisions.filter(
      (decision) => decision.state === "unreconciled/error",
    ).length,
    decisions,
  };
}

function metadataMatchesRuntime(
  runtime: RuntimeModelUsageObservation,
  record: BedrockInvocationLogRecord,
): boolean {
  const metadataValues = new Set(Object.values(record.requestMetadata));
  return Boolean(
    (runtime.traceId && metadataValues.has(runtime.traceId)) ||
      (runtime.threadTurnId && metadataValues.has(runtime.threadTurnId)) ||
      (runtime.requestId && metadataValues.has(runtime.requestId)),
  );
}

function modelsCompatible(
  runtimeModel: string | null,
  providerModel: string,
): boolean {
  if (!runtimeModel) return true;
  const left = normalizeModelForMatch(runtimeModel);
  const right = normalizeModelForMatch(providerModel);
  return left === right || right.includes(left) || left.includes(right);
}

function normalizeModelForMatch(value: string): string {
  return shortenModelId(value)
    .toLowerCase()
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^amazon\./, "");
}

function providerSummary(provider: BedrockInvocationLogRecord) {
  return {
    request_id: provider.requestId,
    operation: provider.operation,
    model_id: provider.modelId,
    input_tokens: provider.inputTokenCount,
    output_tokens: provider.outputTokenCount,
    cached_read_tokens: provider.cacheReadTokenCount,
    cached_write_tokens: provider.cacheWriteTokenCount,
    cost_usd: provider.costUsd,
    duration_ms: provider.durationMs,
    error_state: provider.errorState,
    timestamp: provider.timestamp,
  };
}

function decisionDiagnostic(
  decision: InvocationReconciliationDecision | undefined,
): string | undefined {
  if (!decision) return undefined;
  if (decision.reason === "provider-token-mismatch") {
    return `provider tokens differ by input=${decision.tokenVariance.input}, output=${decision.tokenVariance.output}, cachedRead=${decision.tokenVariance.cachedRead}`;
  }
  if (decision.reason === "ambiguous-provider-logs") {
    return `ambiguous provider logs: ${decision.candidateRequestIds.join(", ")}`;
  }
  if (decision.reason === "no-provider-log") return "no provider log matched";
  return undefined;
}

function lookupPricing(modelId: string): { input: number; output: number } {
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) return pricing;
  }
  return { input: 3.0, output: 15.0 };
}

export function shortenModelId(modelId: string): string {
  const parts = modelId.split("/");
  const name = parts[parts.length - 1] || modelId;
  return name.replace(/^us\.anthropic\./, "").replace(/-v\d+:\d+$/, "");
}

function extractInputPreview(inputBodyJson: unknown): string {
  const inputBody = readRecord(inputBodyJson);
  const parts: string[] = [];

  const system = inputBody.system;
  if (system) {
    const sys = Array.isArray(system)
      ? system.map((s) => stringValue(readRecord(s).text) || "").join("\n")
      : String(system);
    if (sys) parts.push(`[System]\n${sys}`);
  }

  for (const msg of readArray(inputBody.messages)) {
    const message = readRecord(msg);
    const role =
      message.role === "user"
        ? "User"
        : message.role === "assistant"
          ? "Assistant"
          : String(message.role ?? "Message");
    const content = message.content;
    if (typeof content === "string") {
      parts.push(`[${role}] ${content}`);
    } else if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const blockValue of content) {
        const block = readRecord(blockValue);
        if (block.type === "text" && block.text) {
          textParts.push(String(block.text));
        }
        if (block.type === "tool_use") {
          textParts.push(
            `[tool_use: ${String(block.name)}(${JSON.stringify(block.input).slice(0, 200)})]`,
          );
        }
        if (block.type === "tool_result") {
          textParts.push(
            `[tool_result: ${JSON.stringify(block.content).slice(0, 200)}]`,
          );
        }
        const toolUse = readRecord(block.toolUse);
        if (toolUse.name) textParts.push(`[tool_use: ${String(toolUse.name)}]`);
        const toolResult = readRecord(block.toolResult);
        if (toolResult.content) {
          const trContent = toolResult.content;
          const trText = Array.isArray(trContent)
            ? trContent
                .map((c) => {
                  const record = readRecord(c);
                  if (record.text) return String(record.text);
                  if (record.json) return JSON.stringify(record.json);
                  return JSON.stringify(record);
                })
                .join("\n")
                .slice(0, 5000)
            : typeof trContent === "string"
              ? trContent.slice(0, 5000)
              : JSON.stringify(trContent).slice(0, 5000);
          textParts.push(`[tool_result: ${trText || "(no content)"}]`);
        }
      }
      if (textParts.length) parts.push(`[${role}] ${textParts.join("\n")}`);
    }
  }

  const tools = readArray(readRecord(inputBody.toolConfig).tools);
  if (tools.length > 0) {
    const toolNames = tools
      .map(
        (tool) =>
          stringValue(readRecord(readRecord(tool).toolSpec).name) || "?",
      )
      .join(", ");
    parts.push(`[Tools] ${toolNames}`);
  }

  return parts.join("\n\n");
}

function extractOutputPreview(outputBodyJson: unknown): string {
  const outputBody = readRecord(outputBodyJson);
  const content =
    readArray(readRecord(readRecord(outputBody.output).message).content) ||
    readArray(outputBody.content);
  if (content.length > 0) {
    const textParts = content.flatMap((blockValue) => {
      const block = readRecord(blockValue);
      if (block.type === "text" && block.text) return [String(block.text)];
      if (block.type === "tool_use") return [`[tool: ${String(block.name)}]`];
      if (readRecord(block.toolUse).name) {
        return [`[tool: ${String(readRecord(block.toolUse).name)}]`];
      }
      return [];
    });
    if (textParts.length > 0) return textParts.join("\n").slice(0, 10000);
  }

  if (Array.isArray(outputBodyJson)) {
    return outputBodyJson
      .flatMap((chunkValue) => {
        const chunk = readRecord(chunkValue);
        const delta = readRecord(chunk.delta);
        return chunk.type === "content_block_delta" && delta.text
          ? [String(delta.text)]
          : [];
      })
      .join("")
      .slice(0, 10000);
  }

  return "";
}

function extractSystemText(system: unknown): string {
  if (Array.isArray(system)) {
    return system
      .map((entry) => stringValue(readRecord(entry).text) || "")
      .join(" ");
  }
  return system ? String(system) : "";
}

function inferInvocationBranch(systemText: string): string {
  const systemLen = systemText.length;
  const hasParentMarkers =
    systemText.includes("Workspace Map") ||
    systemText.includes("Task Router") ||
    systemText.includes("# Soul") ||
    systemText.includes("# Identity");
  if (systemLen === 0 || hasParentMarkers) return "parent";
  const nameMatch =
    systemText.match(/^#\s+(.+)$/m) || systemText.match(/#\s+(.+?)(?:\n|$)/);
  const subAgentName = nameMatch
    ? nameMatch[1].trim().toLowerCase().replace(/\s+/g, "-")
    : "unknown";
  return `sub-agent:${subAgentName}`;
}

function parseJsonObject(
  message: string | undefined,
): Record<string, unknown> | null {
  if (!message) return null;
  const parsed = JSON.parse(message) as unknown;
  return readRecord(parsed);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringMap(value: unknown): Record<string, string> {
  const record = readRecord(value);
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, val]) =>
      typeof val === "string" ? [[key, val]] : [],
    ),
  );
}

function stringArray(value: unknown): string[] {
  return readArray(value).flatMap((item) =>
    typeof item === "string" && item.length > 0 ? [item] : [],
  );
}

function numberValue(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nonNegativeInt(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(Math.trunc(numeric), 2_147_483_647);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
