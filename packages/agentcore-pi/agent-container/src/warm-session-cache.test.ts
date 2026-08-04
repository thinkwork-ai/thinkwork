import { describe, expect, it } from "vitest";
import {
  WarmSessionCache,
  createWarmSessionCacheIfRuntime,
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

function entry(value = "session") {
  return {
    value,
    durableStoreMarker: "head-1",
    authorizationVersion: "v1",
    cachedAtMs: 0,
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
