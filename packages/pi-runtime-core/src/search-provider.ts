/**
 * SearchProvider — the host-supplied seam for ThinkWork's unified search
 * broker (THINK-263 U8).
 *
 * A narrow request/response contract; the host supplies transport + identity. The search extension reaches the
 * broker ONLY through this interface — it never builds an HTTP/GraphQL client
 * of its own — so the extension is identical on the cloud and desktop hosts.
 *
 * Identity discipline: tenant AND the invoking user are resolved SERVER-SIDE
 * from a turn-bound reference the host closes over (snapshot-at-entry, never
 * re-read from env mid-turn — see feedback_completion_callback_snapshot_pattern).
 * The tool params carry NO tenant/user/thread identifiers, so a prompt-injected
 * turn cannot flip scope by parameter. Critically, the broker runs as the
 * turn's user, so its thread-visibility and memory scoping match exactly what
 * that user would see in the web palette (R2/R3).
 */

/** One source-tagged group of hits from a single retrieval leg. */
export interface SearchLegResult {
  /** Retrieval source: "THREADS" | "MEMORY". */
  source: string;
  /** Per-leg status: "OK" | "TIMEOUT" | "ERROR". */
  status: string;
  /** Short, model-facing lines describing this leg's hits (never raw rows). */
  lines: string[];
}

export interface SearchProviderRequest {
  /** Free-text query. */
  query: string;
  /**
   * Which legs to run. Omitted → the broker's default find set
   * (threads; memory is opt-in). The agent tool defaults to
   * the find set and does not run the memory leg unless asked.
   */
  sources?: string[];
  /** Optional cap on hits per leg (bounded by the backend). */
  limit?: number;
}

export interface SearchProviderResult {
  legs: SearchLegResult[];
}

export interface SearchProvider {
  /**
   * Fan-out search over the tenant brain, scoped to the turn's user. The
   * optional `signal` lets the caller cancel an in-flight call — the tool
   * passes the turn's abort signal so a user abort / host timeout tears down
   * the underlying request instead of orphaning it.
   */
  search(
    request: SearchProviderRequest,
    signal?: AbortSignal,
  ): Promise<SearchProviderResult>;
}
