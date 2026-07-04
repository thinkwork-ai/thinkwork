/**
 * Per-part-id append cursor merge for `UIMessageChunk` streams.
 *
 * Plan-012 U6. Replaces the legacy `seq < highest - 2` chunk-window heuristic
 * in `use-computer-thread-chunks.ts` for chunks that arrive on a Computer
 * thread with `ui_message_emit=True`. Heterogeneous part streams
 * (text → tool → reasoning → text → tool-renderFragment) cannot tolerate the
 * legacy heuristic — a late tool-output-available chunk would silently
 * disappear past the seq window. Per-part-id cursors fix this.
 *
 * Contract: docs/specs/computer-ai-elements-contract-v1.md
 *   §Per-part-id append cursor rule
 *   §Legacy-vs-protocol detection (shape-based, not id-based)
 */

import { parseChunkPayload } from "./ui-message-chunk-parser";
import type { ParsedChunk, UIMessagePart } from "./ui-message-types";

/**
 * One part record on the consumer side. Discriminator subset of
 * `UIMessagePart` plus a `state` field so the renderer can show streaming
 * vs. terminal differently.
 */
export type AccumulatedPart =
  | {
      type: "text";
      id: string;
      text: string;
      state: "streaming" | "done";
    }
  | {
      type: "reasoning";
      id: string;
      text: string;
      state: "streaming" | "done";
    }
  | {
      type: `tool-${string}`;
      toolCallId: string;
      toolName: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      state:
        | "input-streaming"
        | "input-available"
        | "output-available"
        | "output-error";
    }
  | {
      type: `data-${string}`;
      id?: string;
      data: unknown;
    }
  | {
      type: "source-url";
      sourceId: string;
      url: string;
      title?: string;
    }
  | {
      type: "source-document";
      sourceId: string;
      mediaType: string;
      title: string;
      filename?: string;
    }
  | {
      type: "file";
      url: string;
      mediaType: string;
    };

export interface UIMessageStreamState {
  /**
   * Parts in arrival order (per-part-id cursor mutates in place; new ids
   * append).
   */
  parts: AccumulatedPart[];
  /**
   * Forward-compat fallback: chunks without a string `type` and with a
   * string `text` field (the legacy `{text}` envelope from
   * appsync_publisher.py) accumulate here so the legacy thread-surface
   * path keeps working.
   */
  legacyText: string;
  /**
   * Lifecycle marker — `start` fires on the first transport event,
   * `finish` / `abort` on the corresponding chunks. Renderers can show
   * "streaming" UI based on this.
   */
  status: "idle" | "streaming" | "done" | "errored" | "aborted";
  /**
   * Last error text from an `error`-type chunk, surfaced to the renderer.
   */
  errorText?: string;
  /**
   * AppSync can replay subscription payloads after reconnects. The typed
   * merge receives the transport sequence when available and uses this hidden
   * cursor to keep text/reasoning deltas idempotent.
   */
  seenChunkSeqs?: number[];
}

export function emptyState(): UIMessageStreamState {
  return {
    parts: [],
    legacyText: "",
    status: "idle",
  };
}

/**
 * Given the current accumulator state and one `UIMessageChunk`, return a
 * new state. Mutation is avoided so React state updates are stable.
 */
export function mergeUIMessageChunk(
  state: UIMessageStreamState,
  chunk: unknown,
  deliverySeq?: number | null,
): UIMessageStreamState {
  if (typeof deliverySeq === "number") {
    if ((state.seenChunkSeqs ?? []).includes(deliverySeq)) return state;
  }
  const parsed: ParsedChunk = parseChunkPayload(chunk);
  const withSeq = (next: UIMessageStreamState): UIMessageStreamState => {
    if (typeof deliverySeq !== "number" || next === state) return next;
    return {
      ...next,
      seenChunkSeqs: [...(state.seenChunkSeqs ?? []), deliverySeq].slice(-500),
    };
  };
  switch (parsed.kind) {
    case "drop":
      return state;
    case "legacy":
      return withSeq({
        ...state,
        legacyText: state.legacyText + parsed.chunk.text,
        status: state.status === "idle" ? "streaming" : state.status,
      });
    case "protocol":
      return withSeq(applyProtocolChunk(state, parsed.chunk));
    default:
      return state;
  }
}

function applyProtocolChunk(
  state: UIMessageStreamState,
  chunk: Record<string, unknown> & { type: string },
): UIMessageStreamState {
  const parts = [...state.parts];

  switch (chunk.type) {
    case "start":
      return {
        ...state,
        status: "streaming",
        parts,
      };
    case "finish":
      return { ...state, status: "done", parts };
    case "abort":
      return { ...state, status: "aborted", parts };
    case "error":
      return {
        ...state,
        status: "errored",
        errorText:
          typeof chunk.errorText === "string" ? chunk.errorText : undefined,
        parts,
      };
    case "start-step":
    case "finish-step":
      return state;
    case "text-start": {
      const id = chunk.id as string;
      if (findById(parts, id) !== -1) return state;
      parts.push({ type: "text", id, text: "", state: "streaming" });
      return { ...state, parts, status: "streaming" };
    }
    case "text-delta": {
      const id = chunk.id as string;
      const idx = findById(parts, id);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (existing.type !== "text") return state;
      if (existing.state === "done") return state;
      parts[idx] = {
        ...existing,
        text: existing.text + (chunk.delta as string),
      };
      return { ...state, parts };
    }
    case "text-end": {
      const id = chunk.id as string;
      const idx = findById(parts, id);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (existing.type !== "text") return state;
      parts[idx] = { ...existing, state: "done" };
      return { ...state, parts };
    }
    case "reasoning-start": {
      const id = chunk.id as string;
      if (findById(parts, id) !== -1) return state;
      parts.push({
        type: "reasoning",
        id,
        text: "",
        state: "streaming",
      });
      return { ...state, parts, status: "streaming" };
    }
    case "reasoning-delta": {
      const id = chunk.id as string;
      const idx = findById(parts, id);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (existing.type !== "reasoning") return state;
      if (existing.state === "done") return state;
      parts[idx] = {
        ...existing,
        text: existing.text + (chunk.delta as string),
      };
      return { ...state, parts };
    }
    case "reasoning-end": {
      const id = chunk.id as string;
      const idx = findById(parts, id);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (existing.type !== "reasoning") return state;
      parts[idx] = { ...existing, state: "done" };
      return { ...state, parts };
    }
    case "tool-input-start": {
      const toolCallId = chunk.toolCallId as string;
      if (findByToolCallId(parts, toolCallId) !== -1) return state;
      parts.push({
        type: `tool-${chunk.toolName as string}` as `tool-${string}`,
        toolCallId,
        toolName: chunk.toolName as string,
        state: "input-streaming",
      });
      return { ...state, parts, status: "streaming" };
    }
    case "tool-input-available": {
      const toolCallId = chunk.toolCallId as string;
      const idx = findByToolCallId(parts, toolCallId);
      if (idx === -1) {
        parts.push({
          type: `tool-${chunk.toolName as string}` as `tool-${string}`,
          toolCallId,
          toolName: chunk.toolName as string,
          input: chunk.input,
          state: "input-available",
        });
      } else {
        const existing = parts[idx];
        if (existing.type.startsWith("tool-")) {
          parts[idx] = {
            ...(existing as Extract<
              AccumulatedPart,
              { type: `tool-${string}` }
            >),
            input: chunk.input,
            state: "input-available",
          };
        }
      }
      return { ...state, parts, status: "streaming" };
    }
    case "tool-output-available": {
      const toolCallId = chunk.toolCallId as string;
      const idx = findByToolCallId(parts, toolCallId);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (!existing.type.startsWith("tool-")) return state;
      parts[idx] = {
        ...(existing as Extract<AccumulatedPart, { type: `tool-${string}` }>),
        output: chunk.output,
        state: "output-available",
      };
      return { ...state, parts };
    }
    case "tool-output-error":
    case "tool-input-error": {
      const toolCallId = chunk.toolCallId as string;
      const idx = findByToolCallId(parts, toolCallId);
      if (idx === -1) return state;
      const existing = parts[idx];
      if (!existing.type.startsWith("tool-")) return state;
      parts[idx] = {
        ...(existing as Extract<AccumulatedPart, { type: `tool-${string}` }>),
        errorText:
          typeof chunk.errorText === "string" ? chunk.errorText : undefined,
        state: "output-error",
      };
      return { ...state, parts };
    }
    case "source-url": {
      parts.push({
        type: "source-url",
        sourceId: chunk.sourceId as string,
        url: chunk.url as string,
        title: typeof chunk.title === "string" ? chunk.title : undefined,
      });
      return { ...state, parts };
    }
    case "source-document": {
      parts.push({
        type: "source-document",
        sourceId: chunk.sourceId as string,
        mediaType: chunk.mediaType as string,
        title: chunk.title as string,
        filename:
          typeof chunk.filename === "string" ? chunk.filename : undefined,
      });
      return { ...state, parts };
    }
    case "file": {
      parts.push({
        type: "file",
        url: chunk.url as string,
        mediaType: chunk.mediaType as string,
      });
      return { ...state, parts };
    }
    default: {
      if (chunk.type.startsWith("data-")) {
        if (typeof chunk.id === "string") {
          const idx = findDataByTypeAndId(parts, chunk.type, chunk.id);
          if (idx !== -1) {
            parts[idx] = {
              type: chunk.type as `data-${string}`,
              id: chunk.id,
              data: chunk.data,
            };
            return { ...state, parts };
          }
        }
        parts.push({
          type: chunk.type as `data-${string}`,
          id: typeof chunk.id === "string" ? chunk.id : undefined,
          data: chunk.data,
        });
        return { ...state, parts };
      }
      return state;
    }
  }
}

function findById(parts: AccumulatedPart[], id: string): number {
  return parts.findIndex((p) => "id" in p && (p as { id: string }).id === id);
}

function findByToolCallId(
  parts: AccumulatedPart[],
  toolCallId: string,
): number {
  return parts.findIndex(
    (p) =>
      "toolCallId" in p &&
      (p as { toolCallId: string }).toolCallId === toolCallId,
  );
}

function findDataByTypeAndId(
  parts: AccumulatedPart[],
  type: string,
  id: string,
): number {
  return parts.findIndex(
    (p) => p.type === type && "id" in p && (p as { id: string }).id === id,
  );
}

/**
 * Convenience: fold a sequence of chunks. Tests + offline replay only —
 * the live consumer drives the merge per-event in a React state setter.
 */
export function mergeUIMessageChunks(
  chunks: unknown[],
  initial: UIMessageStreamState = emptyState(),
): UIMessageStreamState {
  return chunks.reduce<UIMessageStreamState>(
    (state, chunk) => mergeUIMessageChunk(state, chunk),
    initial,
  );
}
