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

export interface ThreadSnapshot {
  /** The flagged turn's user message text — becomes the case `query`. */
  query: string;
  history: SnapshotHistoryPayload;
  workspace: Record<string, unknown> | null;
  traces: SnapshotTracesPayload | null;
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

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

export function buildThreadSnapshot(opts: {
  /** All thread messages, ordered ascending by created_at. */
  messages: ThreadMessageRow[];
  turn: FlaggedTurnRow;
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
    completeness: {
      history: normalized.length > 0,
      workspace: workspace != null,
      traces: traces != null,
      truncated: droppedHistory > 0 || droppedTraces > 0 || workspaceDropped,
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
    name: "history" | "workspace" | "traces",
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
