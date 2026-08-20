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

/**
 * THINK-946 — the SECOND index into the warm products: the same identity
 * MINUS the thread. MCP transports and their tools/list metadata are a
 * function of (tenant, agent, user, config) only, so a new thread on a warm
 * per-user microVM can reuse them instead of paying `initialize` +
 * `tools/list` again (~1.8-4 s of the cross-thread setup).
 *
 * Deliberately NOT the same map as the per-thread entries: thread entries
 * hold thread-bound state (the durable session body/version and the rendered
 * workspace prefix) and spill/expire on their own schedule. Splitting the
 * indexes keeps a thread-cache spill from tearing down connections another
 * thread is still using.
 */
export function warmConnectionKey(
  parts: Omit<WarmSessionKeyParts, "threadId">,
): string {
  const fields = [
    parts.tenantSlug,
    parts.agentSlug,
    parts.userId,
    parts.configFingerprint,
  ];
  if (fields.some((field) => typeof field !== "string" || field === "")) {
    throw new Error("warmConnectionKey: every key field must be non-empty");
  }
  return fields.join("");
}

/**
 * Freshness marker for connection-scoped entries. The durable session store
 * is per-thread and says nothing about a connection's validity — the
 * authorization-version gate (which covers `mcp_configs` and every other
 * credential-bearing field) is the real gate, plus a per-connection liveness
 * ping at reuse time.
 */
export const WARM_CONNECTION_MARKER = "connection-scope";

export interface WarmSessionCacheOptions<T> {
  /**
   * THINK-909 — disposer for entries the cache drops on its OWN initiative
   * (LRU spill, idle-TTL sweep). Those evictions have no caller to close the
   * retained MCP transports the entry holds, so without this the container
   * leaks a live streamable-HTTP connection per spilled entry.
   *
   * NOT called for caller-driven removals ({@link WarmSessionCache.take}
   * gate mismatches, {@link WarmSessionCache.evict},
   * {@link WarmSessionCache.evictThread}) — those call sites already own
   * teardown and would otherwise double-close.
   */
  dispose?: (value: T) => void;
  /** Drop entries idle longer than this (ms). 0 disables the sweep. */
  idleTtlMs?: number;
}

/** Entries idle longer than this are swept; a runtime microVM that has been
 * idle this long is past its keep-warm window, so its retained transports are
 * dead weight (and likely dead connections). */
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;

export class WarmSessionCache<T> {
  private readonly entries = new Map<string, WarmSessionEntry<T>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly dispose?: (value: T) => void;
  private readonly idleTtlMs: number;

  constructor(
    private readonly maxEntries = 8,
    options: WarmSessionCacheOptions<T> = {},
  ) {
    this.dispose = options.dispose;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  }

  /** Best-effort disposal — a throwing disposer must never break the cache. */
  private disposeValue(entry: WarmSessionEntry<T>): void {
    try {
      this.dispose?.(entry.value);
    } catch {
      // Ignore: eviction hygiene is never worth failing a turn.
    }
  }

  /**
   * Drop (and dispose) entries idle past the TTL. Runs on {@link set} and is
   * safe to call directly; `now` is injectable for tests.
   */
  sweepIdle(now = Date.now()): number {
    if (this.idleTtlMs <= 0) return 0;
    let swept = 0;
    for (const [key, entry] of [...this.entries.entries()]) {
      if (now - entry.cachedAtMs < this.idleTtlMs) continue;
      this.entries.delete(key);
      this.disposeValue(entry);
      swept += 1;
    }
    return swept;
  }

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
    // Idle sweep first so a spill only ever drops a still-live entry.
    this.entries.delete(key);
    this.sweepIdle();
    // Small LRU-ish bound: a microVM serves one thread session in practice,
    // but fingerprint churn must not grow the map unboundedly. THINK-909 —
    // a per-user session makes multi-thread churn the norm, so the spilled
    // entry's retained MCP transports must be closed, not orphaned.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        const spilled = this.entries.get(oldest);
        this.entries.delete(oldest);
        if (spilled) this.disposeValue(spilled);
      }
    }
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

  /** Live cached values (THINK-946: lets a second cache answer "do I still
   * own this object?" before disposing it). */
  values(): T[] {
    return [...this.entries.values()].map((entry) => entry.value);
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
  options: WarmSessionCacheOptions<T> = {},
): WarmSessionCache<T> | null {
  return env.AGENTCORE_RUNTIME_SESSION_CACHE === "1"
    ? new WarmSessionCache<T>(8, options)
    : null;
}
