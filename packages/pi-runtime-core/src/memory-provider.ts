/**
 * MemoryProvider — the host-supplied seam for the agent's long-term memory.
 *
 * Inert in this unit: the core defines the contract; the Hindsight-backed
 * implementation and the removal of the managed-AgentCore-Memory path land in
 * U8. After U8 there is exactly one memory engine (Hindsight), so this interface
 * is the only memory surface — there is no engine selector.
 *
 * Recall→reflect chain contract: a `recall` is expected to be followed by a
 * `reflect` in the same turn — recall surfaces the raw prior-memory units to
 * ground the turn, reflect then synthesizes those units into a coherent answer
 * the model can act on. This read-synthesis pairing is load-bearing for memory
 * quality; implementations and callers must preserve it, and the Hindsight
 * wrappers keep their recall/reflect docstrings edited together (see
 * feedback_hindsight_recall_reflect_pair, feedback_hindsight_async_tools).
 *
 * Persistence is a SEPARATE concern, not `reflect`. Writing what a turn learned
 * back to long-term memory is the host's end-of-turn retain path (the
 * `memory-retain` Lambda → the API's normalized memory layer), which fires
 * independently of this read-synthesis chain. `reflect` here does not write —
 * it reasons over what `recall` surfaced. Modeling it as a read keeps the
 * provider faithful to the only memory endpoints the cloud container actually
 * reaches (recall + reflect/synthesize); the write path is host-owned.
 *
 * Usage accounting: both calls return an optional `usage` so the host can
 * populate `hindsight_usage` on the invocation response rather than hardcoding
 * an empty array (closes the gap U9 addresses).
 *
 * Credential discipline: implementations that reach a remote memory service must
 * use credentials/identity snapshotted at loop entry, never re-read from
 * `process.env` mid-turn (see feedback_completion_callback_snapshot_pattern).
 */

/** A single recalled memory. */
export interface MemoryItem {
  id: string;
  content: string;
  /** Relevance score when the backing store provides one. */
  score?: number;
}

export interface MemoryRecallRequest {
  /** The query to recall against (typically the user message or turn context). */
  query: string;
  /** Optional cap on the number of memories returned. */
  limit?: number;
}

export interface MemoryRecallResult {
  memories: MemoryItem[];
  /** Token/cost usage for the recall call, when the backing store reports it. */
  usage?: unknown;
}

export interface MemoryReflectRequest {
  /**
   * The topic to synthesize over — normally the same query passed to the
   * preceding {@link MemoryProvider.recall} (the chain contract). The backing
   * store reasons over the memory units it recalled for this query and returns
   * a coherent answer.
   */
  query: string;
  /** Optional surrounding turn context to focus the synthesis. */
  context?: string;
}

export interface MemoryReflectResult {
  ok: boolean;
  /**
   * The synthesized answer reasoning over the recalled memory units. Present
   * when the backing store produced one; the caller surfaces this text to the
   * model as the reflect tool's result.
   */
  text?: string;
  /** Token/cost usage for the reflect call, when the backing store reports it. */
  usage?: unknown;
}

export interface MemoryProvider {
  /**
   * Recall prior memories relevant to the request. Callers must follow a recall
   * with a {@link MemoryProvider.reflect} in the same turn (see the chain
   * contract in the module doc). The optional `signal` lets the caller cancel an
   * in-flight call — the agent-facing tools pass the turn's abort signal so a
   * user abort / host timeout tears down the underlying request instead of
   * orphaning it; the proactive grounding recall passes a short deadline so a
   * degraded backing store cannot stall turn startup.
   */
  recall(
    request: MemoryRecallRequest,
    signal?: AbortSignal,
  ): Promise<MemoryRecallResult>;

  /**
   * Reflect — synthesize the memory units {@link MemoryProvider.recall}
   * surfaced into a coherent answer. The required follow-up to recall; returns
   * the synthesized text, not a write confirmation (persistence is the host's
   * end-of-turn retain path, see the module doc). The optional `signal`
   * cancels an in-flight call (see {@link MemoryProvider.recall}).
   */
  reflect(
    request: MemoryReflectRequest,
    signal?: AbortSignal,
  ): Promise<MemoryReflectResult>;
}
