import { describe, expect, it } from "vitest";
import {
  WarmSessionCache,
  createWarmSessionCacheIfRuntime,
  warmConnectionKey,
  warmSessionKey,
} from "./warm-session-cache.js";

const keyParts = {
  tenantSlug: "acme",
  agentSlug: "helper",
  userId: "user-1",
  threadId: "thread-1",
  configFingerprint: "fp-1",
};

const freshGates = { durableStoreMarker: "head-1", authorizationVersion: "v1" };

function entry(value = "session", cachedAtMs = Date.now()) {
  return {
    value,
    durableStoreMarker: "head-1",
    authorizationVersion: "v1",
    cachedAtMs,
  };
}

describe("warmSessionKey (KTD6)", () => {
  it("differs per user on the same thread", () => {
    expect(warmSessionKey(keyParts)).not.toBe(
      warmSessionKey({ ...keyParts, userId: "user-2" }),
    );
  });

  it("differs per config fingerprint", () => {
    expect(warmSessionKey(keyParts)).not.toBe(
      warmSessionKey({ ...keyParts, configFingerprint: "fp-2" }),
    );
  });

  it("rejects empty fields", () => {
    expect(() => warmSessionKey({ ...keyParts, userId: "" })).toThrow(
      /non-empty/,
    );
  });
});

describe("WarmSessionCache", () => {
  it("warm hit: exact key + matching gates returns the entry", () => {
    const cache = new WarmSessionCache<string>();
    cache.set(warmSessionKey(keyParts), entry());
    expect(cache.take(warmSessionKey(keyParts), freshGates)?.value).toBe(
      "session",
    );
  });

  it("stale durable store head: evicts and misses", () => {
    const cache = new WarmSessionCache<string>();
    const key = warmSessionKey(keyParts);
    cache.set(key, entry());
    expect(
      cache.take(key, { ...freshGates, durableStoreMarker: "head-2" }),
    ).toBeNull();
    // Evicted — even the original gates miss now.
    expect(cache.take(key, freshGates)).toBeNull();
  });

  it("credential/authorization version change: evicts and misses (R20)", () => {
    const cache = new WarmSessionCache<string>();
    const key = warmSessionKey(keyParts);
    cache.set(key, entry());
    expect(
      cache.take(key, { ...freshGates, authorizationVersion: "v2" }),
    ).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("fingerprint change is a different key: cold path, old entry evictable", () => {
    const cache = new WarmSessionCache<string>();
    cache.set(warmSessionKey(keyParts), entry());
    expect(
      cache.take(
        warmSessionKey({ ...keyParts, configFingerprint: "fp-2" }),
        freshGates,
      ),
    ).toBeNull();
  });

  it("per-thread lock serializes fast-path entry", async () => {
    const cache = new WarmSessionCache<string>();
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = cache.withThreadLock("thread-1", async () => {
      await gate;
      order.push(1);
    });
    const second = cache.withThreadLock("thread-1", async () => {
      order.push(2);
    });
    // Second must not run until the first settles.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it("lock survives a rejecting critical section", async () => {
    const cache = new WarmSessionCache<string>();
    await expect(
      cache.withThreadLock("thread-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(
      cache.withThreadLock("thread-1", async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("bounds entry count", () => {
    const cache = new WarmSessionCache<string>(2);
    for (let i = 0; i < 4; i += 1) {
      cache.set(
        warmSessionKey({ ...keyParts, threadId: `thread-${i}` }),
        entry(),
      );
    }
    expect(cache.size).toBe(2);
  });

  // THINK-909 — a per-user session means several threads churn through one
  // cache, so a spilled entry's retained MCP transports must be closed.
  it("disposes the entry it spills on the LRU bound", () => {
    const closed: string[] = [];
    const cache = new WarmSessionCache<string>(2, {
      dispose: (value) => closed.push(value),
    });
    for (let i = 0; i < 4; i += 1) {
      cache.set(
        warmSessionKey({ ...keyParts, threadId: `thread-${i}` }),
        entry(`session-${i}`),
      );
    }
    expect(closed).toEqual(["session-0", "session-1"]);
    expect(cache.size).toBe(2);
  });

  it("never disposes on caller-driven removal (the caller owns teardown)", () => {
    const closed: string[] = [];
    const cache = new WarmSessionCache<string>(4, {
      dispose: (value) => closed.push(value),
    });
    const key = warmSessionKey(keyParts);
    cache.set(key, entry());
    // Gate mismatch, explicit evict, and thread evict all have a caller that
    // already closes the transports — double-closing would be the bug.
    expect(cache.take(key, { ...freshGates, authorizationVersion: "v2" })).toBe(
      null,
    );
    cache.set(key, entry());
    cache.evict(key);
    cache.set(key, entry());
    cache.evictThread("thread-1");
    expect(closed).toEqual([]);
  });

  it("sweeps and disposes entries idle past the TTL", () => {
    const closed: string[] = [];
    const cache = new WarmSessionCache<string>(8, {
      idleTtlMs: 1000,
      dispose: (value) => closed.push(value),
    });
    const stale = warmSessionKey({ ...keyParts, threadId: "thread-old" });
    cache.set(stale, entry("stale", Date.now() - 5000));
    expect(cache.size).toBe(1);
    // A later write sweeps the idle entry (and disposes it).
    cache.set(warmSessionKey(keyParts), entry("fresh"));
    expect(closed).toEqual(["stale"]);
    expect(cache.take(stale, freshGates)).toBeNull();
    expect(cache.take(warmSessionKey(keyParts), freshGates)?.value).toBe(
      "fresh",
    );
  });

  it("idleTtlMs=0 disables the sweep", () => {
    const cache = new WarmSessionCache<string>(8, { idleTtlMs: 0 });
    const key = warmSessionKey(keyParts);
    cache.set(key, entry("ancient", 0));
    expect(cache.sweepIdle()).toBe(0);
    expect(cache.take(key, freshGates)?.value).toBe("ancient");
  });
});

// ─── THINK-946: the connection-scoped second index ──────────────────────────

describe("warmConnectionKey (THINK-946)", () => {
  const connectionParts = {
    tenantSlug: "acme",
    agentSlug: "helper",
    userId: "user-1",
    configFingerprint: "fp-1",
  };

  it("is the SAME for two threads of one user, agent and config", () => {
    expect(warmConnectionKey(connectionParts)).toBe(
      warmConnectionKey({ ...connectionParts }),
    );
    // …and it is never the per-thread key, so the indexes cannot collide.
    expect(warmConnectionKey(connectionParts)).not.toBe(
      warmSessionKey({ ...connectionParts, threadId: "thread-1" }),
    );
  });

  it("still separates users, agents, tenants and config fingerprints", () => {
    const base = warmConnectionKey(connectionParts);
    expect(
      warmConnectionKey({ ...connectionParts, userId: "user-2" }),
    ).not.toBe(base);
    expect(
      warmConnectionKey({ ...connectionParts, agentSlug: "other" }),
    ).not.toBe(base);
    expect(
      warmConnectionKey({ ...connectionParts, tenantSlug: "other" }),
    ).not.toBe(base);
    expect(
      warmConnectionKey({ ...connectionParts, configFingerprint: "fp-2" }),
    ).not.toBe(base);
  });

  it("rejects empty fields", () => {
    expect(() => warmConnectionKey({ ...connectionParts, userId: "" })).toThrow(
      /non-empty/,
    );
  });
});

describe("WarmSessionCache.values (THINK-946 ownership probe)", () => {
  it("lists live values so a second cache can check ownership", () => {
    const cache = new WarmSessionCache<string>();
    cache.set("a", entry("one"));
    cache.set("b", entry("two"));
    expect(cache.values()).toEqual(["one", "two"]);
    cache.evict("a");
    expect(cache.values()).toEqual(["two"]);
  });
});

describe("createWarmSessionCacheIfRuntime (KTD6 gating)", () => {
  it("constructs only under the runtime-only env signal", () => {
    expect(
      createWarmSessionCacheIfRuntime({ AGENTCORE_RUNTIME_SESSION_CACHE: "1" }),
    ).toBeInstanceOf(WarmSessionCache);
    expect(createWarmSessionCacheIfRuntime({})).toBeNull();
    expect(
      createWarmSessionCacheIfRuntime({
        AGENTCORE_RUNTIME_SESSION_CACHE: "true",
      }),
    ).toBeNull();
  });
});
