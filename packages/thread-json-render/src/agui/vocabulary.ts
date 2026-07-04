import type { ThreadJsonRenderPart } from "../spec.js";

/**
 * AG-UI event vocabulary — pinned snapshot.
 *
 * AG-UI releases are date-tagged, not semver (Living Artifacts KTD1), so we pin
 * a vocabulary snapshot here and own the mapping layer between AG-UI event
 * shapes and our `thread_json_render` parts rather than depending on the AG-UI
 * runtime.
 *
 * Snapshot pinned: 2026-07-04 — against the AG-UI event catalog as exercised by
 * the AWS reference "Build generative UI for AI agents on Amazon Bedrock
 * AgentCore with the AG-UI protocol", which ships a STATE_SNAPSHOT-only sample.
 * When re-pinning to a newer AG-UI dated release, bump this date together with
 * the event-name constants below and re-verify the mapping round-trips.
 */
export const AGUI_VOCABULARY_SNAPSHOT_DATE = "2026-07-04" as const;

/** AG-UI event type: full state replacement (v1 wire format — R1). */
export const AGUI_EVENT_STATE_SNAPSHOT = "STATE_SNAPSHOT" as const;

/**
 * AG-UI event type: RFC 6902 JSON-Patch delta.
 *
 * RESERVED (R2): the envelope carries this variant at compile time so
 * per-element patches can be added later without a wire-format break. v1 emits
 * NO deltas — there is no emit path for {@link ThreadJsonRenderStateDeltaEvent}.
 */
export const AGUI_EVENT_STATE_DELTA = "STATE_DELTA" as const;

/**
 * `thread_turn_events` payload `kind` string that carries a per-part
 * STATE_SNAPSHOT through the existing durable event pipeline (KTD1). Sits
 * alongside the legacy `thread_json_render.ui_message_chunk` kind; both fold to
 * the same part on the web.
 */
export const THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND =
  "thread_json_render.state_snapshot" as const;

/**
 * AG-UI STATE_SNAPSHOT envelope wrapping exactly one json-render part. Per KTD1
 * a snapshot is ALWAYS a single part — never a multi-part canvas in one event —
 * so `assertThreadTurnEventPayloadSize` (64KB) is honored by construction.
 */
export interface ThreadJsonRenderStateSnapshotEvent {
  type: typeof AGUI_EVENT_STATE_SNAPSHOT;
  partId: string;
  snapshot: ThreadJsonRenderPart;
}

/** A single RFC 6902 JSON-Patch operation. RESERVED — not emitted in v1. */
export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * AG-UI STATE_DELTA envelope. RESERVED (R2): exists at the type level only so
 * downstream code can be written against the union without a wire-format break;
 * v1 has no producer.
 */
export interface ThreadJsonRenderStateDeltaEvent {
  type: typeof AGUI_EVENT_STATE_DELTA;
  partId: string;
  /** RFC 6902 operations against the part. */
  delta: JsonPatchOperation[];
}

/** The AG-UI event union the vocabulary understands. */
export type ThreadJsonRenderAgUiEvent =
  | ThreadJsonRenderStateSnapshotEvent
  | ThreadJsonRenderStateDeltaEvent;

/**
 * Data-source binding descriptor (Living Artifacts / THINK-145, KTD4/R4).
 *
 * Captured at the agent-loop toolResult seam and carried additively on the
 * activity-event payload so the persistence side (chat-agent-activity) can
 * upsert an `artifact_data_bindings` row without any runtime→API round trip.
 *
 * v1 binds ONE primary data source per canvas part (`elementId` is always ""),
 * per the plan's "one canvas part = one primary data source" simplification —
 * the row key is (artifact, part, element) so per-element bindings can be added
 * later without a wire-format break.
 *
 * `authContext` is intentionally NOT part of this descriptor: the runtime knows
 * the MCP server NAME but not whether that server is tenant-scoped or per-user
 * OAuth, so classification happens server-side against `tenant_mcp_servers`.
 */
export interface ThreadJsonRenderDataBindingDescriptor {
  /** Canvas part the binding addresses (== the emitted part's stable id). */
  partId: string;
  /** Widget address within the part. "" in v1 (whole-part primary source). */
  elementId: string;
  /** Soft reference to the MCP server (its name; resolved to a row on refresh). */
  serverRef: string;
  /** Captured MCP server display name. */
  serverName: string;
  /** MCP tool name (the real tool, not the `mcp_<server>_<tool>` exposed name). */
  toolName: string;
  /** Frozen arguments of the recorded invocation (unredacted; display gates). */
  frozenArgs: Record<string, unknown>;
  /** Stable hash of the result's sorted key structure (R7). */
  resultShapeHash: string;
}

/**
 * `thread_turn_events.payload` shape for a STATE_SNAPSHOT — the pipeline
 * envelope (`kind` + AG-UI `event`) the web folds on. `binding` is additive
 * (KTD4): present only when the emit declared a valid data source; the web fold
 * ignores it and the persistence side consumes it.
 */
export interface ThreadJsonRenderStateSnapshotPayload {
  kind: typeof THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND;
  event: ThreadJsonRenderStateSnapshotEvent;
  binding?: ThreadJsonRenderDataBindingDescriptor;
}

/**
 * Narrow an arbitrary `thread_turn_events` payload to its data-source binding
 * descriptor when present. Consumed by the persistence side (U5) to upsert the
 * `artifact_data_bindings` row; returns null for any payload without a
 * well-formed `binding`. An absent binding is legal (unbound widget) and must
 * leave existing binding rows untouched (preserve-on-absent, KTD4).
 */
export function bindingDescriptorFromPayload(
  payload: unknown,
): ThreadJsonRenderDataBindingDescriptor | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const binding = (payload as Record<string, unknown>).binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return null;
  }
  const b = binding as Record<string, unknown>;
  if (
    typeof b.partId !== "string" ||
    typeof b.serverRef !== "string" ||
    typeof b.serverName !== "string" ||
    typeof b.toolName !== "string" ||
    typeof b.resultShapeHash !== "string" ||
    !b.frozenArgs ||
    typeof b.frozenArgs !== "object" ||
    Array.isArray(b.frozenArgs)
  ) {
    return null;
  }
  return {
    partId: b.partId,
    elementId: typeof b.elementId === "string" ? b.elementId : "",
    serverRef: b.serverRef,
    serverName: b.serverName,
    toolName: b.toolName,
    frozenArgs: b.frozenArgs as Record<string, unknown>,
    resultShapeHash: b.resultShapeHash,
  };
}

/** part → STATE_SNAPSHOT envelope. */
export function threadJsonRenderPartToStateSnapshot(
  part: ThreadJsonRenderPart,
): ThreadJsonRenderStateSnapshotEvent {
  return {
    type: AGUI_EVENT_STATE_SNAPSHOT,
    partId: part.id,
    snapshot: part,
  };
}

/** STATE_SNAPSHOT envelope → part (round-trip inverse of the above). */
export function stateSnapshotToThreadJsonRenderPart(
  event: ThreadJsonRenderStateSnapshotEvent,
): ThreadJsonRenderPart {
  return event.snapshot;
}

/** Wrap a part in the pipeline payload envelope carried on `thread_turn_events`. */
export function threadJsonRenderStateSnapshotPayload(
  part: ThreadJsonRenderPart,
): ThreadJsonRenderStateSnapshotPayload {
  return {
    kind: THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
    event: threadJsonRenderPartToStateSnapshot(part),
  };
}

/**
 * Narrow an arbitrary `thread_turn_events` payload to the json-render part it
 * carries when (and only when) it is a STATE_SNAPSHOT envelope; returns null
 * otherwise. Web-fold and any future consumer share this unwrap so the
 * envelope shape lives in exactly one place. Unknown/unrelated payloads (and
 * the reserved STATE_DELTA) return null — forward-compatible by construction.
 */
export function partFromThreadJsonRenderStateSnapshotPayload(
  payload: unknown,
): ThreadJsonRenderPart | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.kind !== THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND) {
    return null;
  }
  const event = record.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== AGUI_EVENT_STATE_SNAPSHOT) return null;
  const snapshot = eventRecord.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  return snapshot as ThreadJsonRenderPart;
}
