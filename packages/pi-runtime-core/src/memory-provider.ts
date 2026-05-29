/**
 * MemoryProvider — the host-supplied seam for the agent's long-term memory.
 *
 * Inert in this unit: the core defines the contract; the Hindsight-backed
 * implementation and the removal of the managed-AgentCore-Memory path land in
 * U8. After U8 there is exactly one memory engine (Hindsight), so this interface
 * is the only memory surface — there is no engine selector.
 *
 * Recall→reflect chain contract: a `recall` is expected to be followed by a
 * `reflect` in the same turn — recall surfaces prior memory to ground the turn,
 * reflect writes back what the turn learned. This pairing is load-bearing for
 * memory quality; implementations and callers must preserve it, and the
 * Hindsight wrappers keep their recall/reflect docstrings edited together (see
 * feedback_hindsight_recall_reflect_pair, feedback_hindsight_async_tools).
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
  /** What the turn learned / the interaction to commit to memory. */
  content: string;
  /** Optional surrounding context to store alongside the reflection. */
  context?: string;
}

export interface MemoryReflectResult {
  ok: boolean;
  /** Token/cost usage for the reflect call, when the backing store reports it. */
  usage?: unknown;
}

export interface MemoryProvider {
  /**
   * Recall prior memories relevant to the request. Callers must follow a recall
   * with a {@link MemoryProvider.reflect} in the same turn (see the chain
   * contract in the module doc).
   */
  recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>;

  /**
   * Reflect — write back what the turn learned. The required follow-up to
   * {@link MemoryProvider.recall}.
   */
  reflect(request: MemoryReflectRequest): Promise<MemoryReflectResult>;
}
