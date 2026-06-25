/**
 * Flag-time thread snapshot builder (Evaluations Trust Core U7).
 *
 * When an operator flags a bad thread turn into a dataset, this module
 * captures everything replay (U8) needs into self-contained payload
 * objects under the dataset's guarded S3 prefix:
 *
 *   cases/<case_id>/payload/history.json    — normalized message history
 *                                             up to and including the
 *                                             flagged turn
 *   cases/<case_id>/payload/workspace.json  — the turn's
 *                                             context_snapshot.workspace_projection
 *                                             (THNK-10), when present
 *   cases/<case_id>/payload/traces.json     — tool traces extracted from
 *                                             the message rows
 *                                             (tool_calls/tool_results)
 *   cases/<case_id>/payload/trace-evidence.json
 *                                           — safe summaries and source
 *                                             references from the canonical
 *                                             trace ledger
 *
 * KTD: snapshots are self-contained and degrade gracefully. A
 * pre-THNK-10 thread (no workspace_projection) flags as a badged
 * history-only case; missing traces likewise just flip the completeness
 * flag. The case survives source-thread deletion (AE5) because nothing
 * here references the live thread after capture.
 *
 * Payloads are size-capped (~2MB per object) with truncation markers:
 * oldest entries drop first and the dropped count is recorded so replay
 * and the drill-in UI can show the gap instead of silently lying.
 */

import {
  evalDatasetCasePayloadKey,
  FLAGGED_THREAD_CATEGORY,
  type DatasetContext,
  type DatasetStorage,
  type EvalCaseCompleteness,
  type EvalCaseOutcomeKind,
  type EvalDatasetCaseCore,
} from "./dataset-store.js";

/** Per-object size cap. Large enough for any sane thread; small enough
 *  that a payload object never threatens Lambda memory or S3 GET
 *  latency in the eval worker. */
export const SNAPSHOT_PAYLOAD_CAP_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Input row shapes (subsets of the Drizzle rows the resolver loads)
// ---------------------------------------------------------------------------

export interface ThreadMessageRow {
  id: string;
  role: string;
  content: string | null;
  /** Typed UIMessage parts (jsonb) — takes precedence over `content`. */
  parts?: unknown;
  tool_calls?: unknown;
  tool_results?: unknown;
  created_at?: Date | string | null;
}

export interface FlaggedTurnRow {
  id: string;
  started_at?: Date | string | null;
  finished_at?: Date | string | null;
  /** thread_turns.context_snapshot (jsonb) — THNK-10 writes
   *  workspace_projection into it at dispatch; absent on old threads. */
  context_snapshot?: unknown;
}

// ---------------------------------------------------------------------------
// Output shapes — these ARE the payload-object formats (versioned by key)
// ---------------------------------------------------------------------------

export interface SnapshotMessage {
  id: string;
  /** Lowercase role ('user' | 'assistant' | ...). */
  role: string;
  /** Text content. When the row has no content column value, derived
   *  from its text parts so replay always has usable text. */
  content: string | null;
  /** Typed UIMessage parts, verbatim, when present (render-precedence
   *  rule: parts win over content). */
  parts: unknown | null;
  created_at: string | null;
}

export interface SnapshotHistoryPayload {
  messages: SnapshotMessage[];
  /** Truncation marker: how many oldest messages were dropped at the cap. */
  dropped_oldest_count: number;
  /** The flagged turn's user message — replay sends history before this
   *  message as messages_history and this message's text as the query. */
  flagged_message_id: string | null;
}

export interface SnapshotToolTrace {
  message_id: string;
  role: string;
  created_at: string | null;
  tool_calls: unknown | null;
  tool_results: unknown | null;
}

export interface SnapshotTracesPayload {
  /** Where the traces came from. CloudWatch span capture is deliberately
   *  not attempted at flag time (retention unverified, plan risk note) —
   *  spans_included stays false until a cheap resolvable source exists. */
  source: "messages";
  spans_included: false;
  tool_traces: SnapshotToolTrace[];
  dropped_oldest_count: number;
}

export interface SnapshotTraceEvidenceSourceRef {
  id: string;
  source_type: string;
  source_system: string;
  source_id: string | null;
  uri: string | null;
  observed_at: string | null;
  redaction_state: string;
  safe_summary: Record<string, unknown>;
}

export interface SnapshotTraceEvidenceEvent {
  id: string;
  trace_run_id: string | null;
  event_type: string;
  event_status: string | null;
  request_id: string | null;
  parent_request_id: string | null;
  observed_at: string | null;
  duration_ms: number | null;
  safe_summary: Record<string, unknown>;
  reconciliation_state: string | null;
  reconciliation_source: string | null;
  source_references: SnapshotTraceEvidenceSourceRef[];
}

export interface SnapshotTraceEvidenceGap {
  code: "missing" | "lookup_failed" | "truncated";
  message: string;
  source: "trace_ledger";
}

export interface SnapshotTraceEvidenceRow {
  id: string;
  trace_run_id?: string | null;
  event_type: string;
  event_status?: string | null;
  request_id?: string | null;
  parent_request_id?: string | null;
  observed_at?: Date | string | null;
  duration_ms?: number | null;
  payload_summary?: unknown;
  metadata?: unknown;
  reconciliation_state?: string | null;
  reconciliation_source?: string | null;
  source_evidence?: unknown;
}

export interface SnapshotTraceEvidencePayload {
  source: "trace_ledger";
  events: SnapshotTraceEvidenceEvent[];
  gaps: SnapshotTraceEvidenceGap[];
  dropped_oldest_count: number;
}

export interface ThreadSnapshot {
  /** The flagged turn's user message text — becomes the case `query`. */
  query: string;
  history: SnapshotHistoryPayload;
  workspace: Record<string, unknown> | null;
  traces: SnapshotTracesPayload | null;
  traceEvidence: SnapshotTraceEvidencePayload | null;
  completeness: EvalCaseCompleteness;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

/** Extract readable text from typed UIMessage parts (text parts joined). */
function textFromParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const texts = parts
    .filter(
      (part): part is { type: string; text: string } =>
        isRecord(part) &&
        typeof part.text === "string" &&
        (part.type === "text" || part.type === "response"),
    )
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0);
  return texts.length > 0 ? texts.join("\n\n") : null;
}

/** Best-effort message text: content column first, then text parts. */
export function extractMessageText(row: ThreadMessageRow): string | null {
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (content.length > 0) return row.content;
  return textFromParts(row.parts);
}

/** Normalize one row to the shape replay needs (role/content/parts). */
export function normalizeSnapshotMessage(
  row: ThreadMessageRow,
): SnapshotMessage {
  const parts =
    Array.isArray(row.parts) && row.parts.length > 0 ? row.parts : null;
  return {
    id: row.id,
    role: String(row.role ?? "")
      .trim()
      .toLowerCase(),
    content: row.content ?? (parts ? textFromParts(parts) : null),
    parts,
    created_at: toIso(row.created_at ?? null),
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeString(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function addIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value == null) return;
  target[key] = value;
}

function safePayloadSummary(
  payloadValue: unknown,
  metadataValue: unknown,
): Record<string, unknown> {
  const payload = isRecord(payloadValue) ? payloadValue : {};
  const metadata = isRecord(metadataValue) ? metadataValue : {};
  const summary: Record<string, unknown> = {};
  for (const key of [
    "model",
    "provider",
    "tool_name",
    "name",
    "phase",
    "runtime_type",
    "status",
    "attribution_level",
    "billing_attribution_level",
    "billing_service_code",
    "billing_operation",
  ]) {
    addIfPresent(summary, key, safeString(payload[key] ?? metadata[key]));
  }
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cached_read_tokens",
    "cost_usd",
    "amount_usd",
    "runtime_amount_usd",
    "provider_amount_usd",
    "billed_amount_usd",
    "duration_ms",
    "response_length",
  ]) {
    addIfPresent(summary, key, safeNumber(payload[key] ?? metadata[key]));
  }
  addIfPresent(summary, "tool_call_id", safeString(payload.tool_call_id));
  addIfPresent(
    summary,
    "profile_run_id",
    safeString(metadata.profile_run_id ?? payload.profile_run_id),
  );
  addIfPresent(
    summary,
    "profile_slug",
    safeString(metadata.profile_slug ?? payload.profile_slug),
  );
  addIfPresent(
    summary,
    "lane_key",
    safeString(metadata.lane_key ?? payload.lane_key),
  );
  if (payload.runtime_reported_zero_tokens === true) {
    summary.runtime_reported_zero_tokens = true;
  }
  const bedrockRequestIds = Array.isArray(payload.bedrock_request_ids)
    ? payload.bedrock_request_ids.filter((id) => typeof id === "string")
    : [];
  if (bedrockRequestIds.length > 0) {
    summary.bedrock_request_ids = bedrockRequestIds.slice(0, 10);
  }
  const omittedKeys = Object.keys(payload).filter(
    (key) => !(key in summary) && key !== "bedrock_request_ids",
  );
  if (omittedKeys.length > 0) {
    summary.omitted_payload_keys = omittedKeys.sort();
  }
  return summary;
}

function mapSourceRef(value: unknown): SnapshotTraceEvidenceSourceRef | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    source_type: safeString(value.sourceType ?? value.source_type) ?? "unknown",
    source_system:
      safeString(value.sourceSystem ?? value.source_system) ?? "unknown",
    source_id: safeString(value.sourceId ?? value.source_id),
    uri: safeString(value.uri, 260),
    observed_at: toIso(
      (value.observedAt ?? value.observed_at ?? null) as Date | string | null,
    ),
    redaction_state:
      safeString(value.redactionState ?? value.redaction_state) ??
      "summary_only",
    safe_summary: safePayloadSummary(value.summary, value.metadata),
  };
}

export function buildTraceEvidencePayload(opts: {
  rows?: SnapshotTraceEvidenceRow[];
  gap?: SnapshotTraceEvidenceGap | null;
  capBytes?: number;
}): SnapshotTraceEvidencePayload | null {
  const rows = opts.rows ?? [];
  const gaps: SnapshotTraceEvidenceGap[] = [];
  if (opts.gap) gaps.push(opts.gap);
  if (rows.length === 0 && gaps.length === 0) return null;

  let events = rows.map((row) => ({
    id: row.id,
    trace_run_id: row.trace_run_id ?? null,
    event_type: row.event_type,
    event_status: row.event_status ?? null,
    request_id: row.request_id ?? null,
    parent_request_id: row.parent_request_id ?? null,
    observed_at: toIso(row.observed_at ?? null),
    duration_ms: safeNumber(row.duration_ms),
    safe_summary: safePayloadSummary(row.payload_summary, row.metadata),
    reconciliation_state: row.reconciliation_state ?? null,
    reconciliation_source: row.reconciliation_source ?? null,
    source_references: Array.isArray(row.source_evidence)
      ? row.source_evidence.map(mapSourceRef).filter((ref) => ref != null)
      : [],
  }));

  let dropped = 0;
  const capBytes = opts.capBytes ?? SNAPSHOT_PAYLOAD_CAP_BYTES;
  while (
    events.length > 1 &&
    byteLength({
      source: "trace_ledger",
      events,
      gaps,
      dropped_oldest_count: dropped,
    }) > capBytes
  ) {
    events = events.slice(1);
    dropped += 1;
  }
  if (dropped > 0) {
    gaps.push({
      code: "truncated",
      source: "trace_ledger",
      message: `${dropped} oldest trace evidence event(s) were dropped at the snapshot size cap.`,
    });
  }
  return {
    source: "trace_ledger",
    events,
    gaps,
    dropped_oldest_count: dropped,
  };
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

export function buildThreadSnapshot(opts: {
  /** All thread messages, ordered ascending by created_at. */
  messages: ThreadMessageRow[];
  turn: FlaggedTurnRow;
  traceEvidenceRows?: SnapshotTraceEvidenceRow[];
  traceEvidenceGap?: SnapshotTraceEvidenceGap | null;
  capBytes?: number;
}): ThreadSnapshot {
  const capBytes = opts.capBytes ?? SNAPSHOT_PAYLOAD_CAP_BYTES;

  // History window: everything up to and including the flagged turn.
  // Rows without a usable created_at are kept (degrade to inclusion —
  // dropping them would silently hide context).
  const finishedMs = toMs(opts.turn.finished_at ?? null);
  const windowRows =
    finishedMs == null
      ? opts.messages
      : opts.messages.filter((row) => {
          const ms = toMs(row.created_at ?? null);
          return ms == null || ms <= finishedMs;
        });

  // The flagged turn's user message: nearest-preceding user message to
  // the turn start (mirrors the web transcript's causal pairing). Falls
  // back to the last user message in the window for turns without a
  // started_at (or scheduled turns whose trigger predates every message).
  const startedMs = toMs(opts.turn.started_at ?? null);
  const userRows = windowRows.filter(
    (row) =>
      String(row.role ?? "")
        .trim()
        .toLowerCase() === "user",
  );
  let flaggedRow: ThreadMessageRow | null = null;
  if (startedMs != null) {
    for (const row of userRows) {
      const ms = toMs(row.created_at ?? null);
      if (ms != null && ms <= startedMs) flaggedRow = row;
    }
  }
  if (!flaggedRow && userRows.length > 0) {
    flaggedRow = userRows[userRows.length - 1];
  }

  const query = (flaggedRow && extractMessageText(flaggedRow)?.trim()) || "";

  // Normalize, then cap: drop oldest messages first (never the flagged
  // user message), recording the dropped count as the truncation marker.
  let normalized = windowRows.map(normalizeSnapshotMessage);
  let droppedHistory = 0;
  while (
    normalized.length > 1 &&
    byteLength({ messages: normalized }) > capBytes
  ) {
    const dropIndex = normalized.findIndex(
      (message) => message.id !== flaggedRow?.id,
    );
    if (dropIndex < 0) break;
    normalized = [
      ...normalized.slice(0, dropIndex),
      ...normalized.slice(dropIndex + 1),
    ];
    droppedHistory += 1;
  }

  const history: SnapshotHistoryPayload = {
    messages: normalized,
    dropped_oldest_count: droppedHistory,
    flagged_message_id: flaggedRow?.id ?? null,
  };

  // Tool traces: already on the message rows (tool_calls/tool_results
  // jsonb). Capped independently, oldest first.
  let toolTraces: SnapshotToolTrace[] = windowRows
    .filter((row) => row.tool_calls != null || row.tool_results != null)
    .map((row) => ({
      message_id: row.id,
      role: String(row.role ?? "")
        .trim()
        .toLowerCase(),
      created_at: toIso(row.created_at ?? null),
      tool_calls: row.tool_calls ?? null,
      tool_results: row.tool_results ?? null,
    }));
  let droppedTraces = 0;
  while (
    toolTraces.length > 1 &&
    byteLength({ tool_traces: toolTraces }) > capBytes
  ) {
    toolTraces = toolTraces.slice(1);
    droppedTraces += 1;
  }
  const traces: SnapshotTracesPayload | null =
    toolTraces.length > 0
      ? {
          source: "messages",
          spans_included: false,
          tool_traces: toolTraces,
          dropped_oldest_count: droppedTraces,
        }
      : null;

  const traceEvidence = buildTraceEvidencePayload({
    rows: opts.traceEvidenceRows ?? [],
    gap: opts.traceEvidenceGap ?? null,
    capBytes,
  });

  // Workspace projection (THNK-10): degrade gracefully when absent —
  // pre-THNK-10 threads flag as badged history-only cases, never blocked.
  let contextSnapshot: unknown = opts.turn.context_snapshot;
  if (typeof contextSnapshot === "string") {
    try {
      contextSnapshot = JSON.parse(contextSnapshot);
    } catch {
      contextSnapshot = null;
    }
  }
  let workspace: Record<string, unknown> | null = null;
  let workspaceDropped = false;
  if (
    isRecord(contextSnapshot) &&
    isRecord(contextSnapshot.workspace_projection)
  ) {
    workspace = contextSnapshot.workspace_projection;
    if (byteLength(workspace) > capBytes) {
      // A projection larger than the cap can't be partially meaningful —
      // drop it whole and flag the truncation rather than store a torn copy.
      workspace = null;
      workspaceDropped = true;
    }
  }

  return {
    query,
    history,
    workspace,
    traces,
    traceEvidence,
    completeness: {
      history: normalized.length > 0,
      workspace: workspace != null,
      traces: traces != null || (traceEvidence?.events.length ?? 0) > 0,
      truncated:
        droppedHistory > 0 ||
        droppedTraces > 0 ||
        workspaceDropped ||
        (traceEvidence?.dropped_oldest_count ?? 0) > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Payload writes (storage seam — production wiring is S3)
// ---------------------------------------------------------------------------

/**
 * Write the snapshot's payload objects under the dataset's guarded
 * prefix. Called BEFORE the case file lands so the case never points at
 * missing payloads. Returns the keys written.
 */
export async function writeFlaggedCasePayloads(
  ctx: DatasetContext,
  caseId: string,
  snapshot: ThreadSnapshot,
  storage: DatasetStorage,
): Promise<string[]> {
  const written: string[] = [];
  const write = async (
    name: "history" | "workspace" | "traces" | "trace-evidence",
    payload: unknown,
  ) => {
    const key = evalDatasetCasePayloadKey(
      ctx.tenantSlug,
      ctx.slug,
      caseId,
      name,
    );
    await storage.write(key, JSON.stringify(payload, null, 2));
    written.push(key);
  };

  // History always lands (even when empty) so replay has one canonical
  // object to load; workspace/traces only exist when captured — their
  // absence is exactly what the completeness badges describe.
  await write("history", snapshot.history);
  if (snapshot.workspace != null) await write("workspace", snapshot.workspace);
  if (snapshot.traces != null) await write("traces", snapshot.traces);
  if (snapshot.traceEvidence != null) {
    await write("trace-evidence", snapshot.traceEvidence);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Case identity + case file
// ---------------------------------------------------------------------------

function shortIdSegment(id: string): string {
  const cleaned = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned.slice(0, 8) || "x";
}

/**
 * Deterministic-ish case id from the flagged (thread, turn) pair —
 * timestamp-free so re-flagging the same turn collides visibly (the
 * resolver suffixes on collision). Always starts with a letter and stays
 * far under the 128-char case-id budget.
 */
export function flaggedCaseIdBase(threadId: string, turnId: string): string {
  return `flagged-${shortIdSegment(threadId)}-${shortIdSegment(turnId)}`;
}

const CASE_NAME_MAX = 120;

/**
 * Build the engine-neutral case file core for a flagged-thread case.
 * The llm-rubric assertion derives from the resolution target verbatim
 * for now — U8 hardens judging (system-parameter framing, delimited
 * rubric, strict response schema).
 */
export function buildFlaggedCaseCore(opts: {
  caseId: string;
  threadId: string;
  turnId: string;
  threadTitle?: string | null;
  snapshot: ThreadSnapshot;
  resolutionTarget: string;
  outcomeKind: EvalCaseOutcomeKind;
  flaggedAt?: string;
}): EvalDatasetCaseCore {
  const title = opts.threadTitle?.trim();
  const name = (
    title
      ? `Flagged: ${title}`
      : `Flagged thread ${shortIdSegment(opts.threadId)}`
  ).slice(0, CASE_NAME_MAX);
  return {
    case_id: opts.caseId,
    name,
    category: FLAGGED_THREAD_CATEGORY,
    query: opts.snapshot.query || "(no user message captured)",
    system_prompt: null,
    expected_behavior: opts.resolutionTarget,
    assertions: [{ type: "llm-rubric", value: opts.resolutionTarget }],
    tags: ["flagged-thread", opts.outcomeKind],
    enabled: true,
    source: {
      source_thread_id: opts.threadId,
      source_turn_id: opts.turnId,
      flagged_at: opts.flaggedAt ?? new Date().toISOString(),
    },
    resolution_target: opts.resolutionTarget,
    outcome_kind: opts.outcomeKind,
    completeness: opts.snapshot.completeness,
  };
}
