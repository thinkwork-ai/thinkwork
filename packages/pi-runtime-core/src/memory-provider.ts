/**
 * MemoryProvider — the host-supplied seam for the agent's long-term memory.
 *
 * The core defines the contract; hosts decide which backend is active. In the
 * Cognee-first path, agents should prefer Context Engine memory search for
 * user-carried and space-owned memory. This provider remains the explicit
 * recall/reflect seam for legacy Hindsight mode and any future host-supplied
 * read-synthesis backend.
 *
 * Recall→reflect chain contract: a `recall` is expected to be followed by a
 * `reflect` in the same turn — recall surfaces the raw prior-memory units to
 * ground the turn, reflect then synthesizes those units into a coherent answer
 * the model can act on. This read-synthesis pairing is load-bearing for memory
 * quality; implementations and callers must preserve it, and backend wrappers
 * keep their recall/reflect docstrings edited together (see
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
export interface MemoryEvidenceSourceFact {
  id: string;
  type?: string | null;
  context?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryBasedOnEvidence {
  memoryIds: string[];
  mentalModelIds: string[];
  directiveIds: string[];
  memories?: MemoryEvidenceSourceFact[];
  mentalModels?: MemoryEvidenceSourceFact[];
  directives?: MemoryEvidenceSourceFact[];
}

export interface MemoryEvidence {
  sourceFactIds?: string[];
  sourceFacts?: MemoryEvidenceSourceFact[];
  basedOn?: MemoryBasedOnEvidence;
}

export interface MemoryItem {
  id: string;
  content: string;
  /** Logical source scope for multi-bank recall; never exposes raw bank ids. */
  sourceScope?: "user" | "space";
  /** Relevance score when the backing store provides one. */
  score?: number;
  /** Backing-store fact type (e.g. "world", "experience", "observation"). */
  factType?: string;
  /**
   * Freshness trend for consolidated observations (e.g. "stable",
   * "strengthening", "weakening", "new", "stale"). Only present when the
   * backing store synthesizes observations and reports the signal.
   */
  freshness?: string;
  /** Number of supporting facts behind a consolidated observation. */
  proofCount?: number;
  /** Redacted backing-store evidence descriptors; raw source text is omitted. */
  evidence?: MemoryEvidence;
}

export interface MemoryRecallRequest {
  /** The query to recall against (typically the user message or turn context). */
  query: string;
  /** Optional cap on the number of memories returned. */
  limit?: number;
  /** Optional temporal anchor for Hindsight recall ranking/filtering. */
  queryTimestamp?: string | null;
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
  /** Redacted backing-store evidence descriptors; raw source text is omitted. */
  evidence?: MemoryEvidence;
  trace?: unknown;
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
