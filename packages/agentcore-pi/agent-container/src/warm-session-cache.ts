/**
 * Warm-session cache (THINK-586 U7, KTD6).
 *
 * Holds the expensive per-thread bootstrap products — the constructed Pi
 * session, connected MCP clients + tool definitions, and the assembled
 * toolset — so a warm AgentCore microVM can skip re-bootstrap on the next
 * turn of the same thread. Latency-only: the S3 durable session store
 * remains the correctness source (R10); any doubt evicts and takes the
 * full cold path.
 *
 * Isolation rules (tenant-isolation audit):
 * - Factory-constructed, never a module-level bare Map. The factory is
 *   built ONLY when the runtime-only environment signal is present
 *   (AGENTCORE_RUNTIME_SESSION_CACHE, injected as an overlay by the
 *   runtime env mirror — never present in the Pi Lambda's Terraform env,
 *   so the Lambda path structurally cannot reach the cache).
 * - Key includes userId: same thread viewed by a different user is a miss.
 * - Reuse requires exact identity + config_fingerprint match PLUS the
 *   caller-supplied freshness gates (durable-store head probe, credential/
 *   authorization version — R20). Mismatch anywhere → evict, cold path.
 */

export interface WarmSessionKeyParts {
  tenantSlug: string;
  agentSlug: string;
  userId: string;
  threadId: string;
  configFingerprint: string;
}

export interface WarmSessionEntry<T> {
  /** The cached bootstrap products (session, MCP clients, toolset). */
  value: T;
  /** Durable-store freshness marker recorded when the entry was cached
   * (e.g. the S3 session head ETag / last event id). The reuse gate
   * compares this against the live head and evicts on mismatch. */
  durableStoreMarker: string;
  /** Credential/authorization version signal (R20). */
  authorizationVersion: string;
  cachedAtMs: number;
}

export function warmSessionKey(parts: WarmSessionKeyParts): string {
  const fields = [
    parts.tenantSlug,
    parts.agentSlug,
    parts.userId,
    parts.threadId,
    parts.configFingerprint,
  ];
  if (fields.some((field) => typeof field !== "string" || field === "")) {
    throw new Error("warmSessionKey: every key field must be non-empty");
  }
  // U+001F cannot appear in slugs/uuids/fingerprints — collision-safe join.
  return fields.join("");
}

export class WarmSessionCache<T> {
  private readonly entries = new Map<string, WarmSessionEntry<T>>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries = 8) {}

  /**
   * Serialize fast-path entry per thread: the durable-session design allows
   * concurrent turns per container, and interleaved fast-path state would
   * corrupt the cache. Later callers for the same threadId wait for the
   * earlier turn's critical section to settle (fulfilled OR rejected).
   */
  async withThreadLock<R>(threadId: string, fn: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(threadId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    // The chain stored for the NEXT waiter must not reject.
    this.locks.set(
      threadId,
      run.catch(() => undefined),
    );
    try {
      return await run;
    } finally {
      if (this.locks.get(threadId) === run) this.locks.delete(threadId);
    }
  }

  /**
   * Gate-free lookup: lets the caller see whether a candidate exists
   * BEFORE spending the (S3 head) freshness probe, and lets it dispose
   * held resources when the subsequent gated {@link take} evicts.
   */
  peek(key: string): WarmSessionEntry<T> | null {
    return this.entries.get(key) ?? null;
  }

  /**
   * Reuse gate: exact key hit AND both freshness signals match. Any
   * mismatch evicts and returns null (cold path). Never throws.
   */
  take(
    key: string,
    gates: { durableStoreMarker: string; authorizationVersion: string },
  ): WarmSessionEntry<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (
      entry.durableStoreMarker !== gates.durableStoreMarker ||
      entry.authorizationVersion !== gates.authorizationVersion
    ) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, entry: WarmSessionEntry<T>): void {
    // Small LRU-ish bound: a microVM serves one thread session in practice,
    // but fingerprint churn must not grow the map unboundedly.
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  evict(key: string): void {
    this.entries.delete(key);
  }

  /** Evict every entry for a thread regardless of fingerprint/user. */
  evictThread(threadId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.split("")[3] === threadId) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Runtime-only gating: the factory returns a cache ONLY when the AgentCore
 * runtime deploy path set the overlay env var. The Pi Lambda's Terraform
 * env must never define it (see agentcore-pi/main.tf note) — the Lambda
 * path structurally cannot construct the cache.
 */
export function createWarmSessionCacheIfRuntime<T>(
  env: Record<string, string | undefined> = process.env,
): WarmSessionCache<T> | null {
  return env.AGENTCORE_RUNTIME_SESSION_CACHE === "1"
    ? new WarmSessionCache<T>()
    : null;
}
