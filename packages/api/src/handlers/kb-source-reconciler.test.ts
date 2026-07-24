/**
 * kb-source-reconciler handler tests (external S3 KB source U6).
 *
 * getDb() is mocked; probe/dispatch are injected. Covers AE7's revoke →
 * skip → restore cycle, CAS guards on status flips, and sync-mode dispatch
 * that skips revoked/failed sources.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sources: [] as Record<string, unknown>[],
  updates: [] as {
    set: Record<string, unknown>;
    condValues: unknown[];
  }[],
}));

function condValues(cond: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if ("value" in node && node.constructor?.name === "Param") {
      if (Array.isArray(node.value)) out.push(...node.value);
      else out.push(node.value);
      return;
    }
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(cond);
  return out;
}

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(h.sources) }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const values = condValues(cond);
          h.updates.push({ set, condValues: values });
          // Apply the CAS: the first value is the row id, the rest are the
          // allowed prior statuses.
          const [id, ...allowed] = values;
          const row = h.sources.find((source) => source.id === id);
          if (
            row &&
            (allowed.length === 0 ||
              allowed.includes(row.access_status as string))
          ) {
            Object.assign(row, set);
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});

import { handler } from "./kb-source-reconciler.js";

function seedSource(overrides: Record<string, unknown> = {}) {
  const source = {
    id: `src-${h.sources.length + 1}`,
    tenant_id: "t1",
    knowledge_base_id: "kb-1",
    kind: "s3-connect",
    bucket: "cx-to-s3",
    prefix: "cx/files/",
    access_status: "healthy",
    sentinel_document_key: "cx/files/sop.pdf",
    error_message: null,
    ...overrides,
  };
  h.sources.push(source);
  return source;
}

beforeEach(() => {
  h.sources.length = 0;
  h.updates.length = 0;
});

describe("probe mode", () => {
  it("AE7: failing probe flips healthy → access_revoked; passing probe restores", async () => {
    const source = seedSource();
    await handler({ mode: "probe" }, undefined, {
      probeSource: async () => ({ ok: false, reason: "AccessDenied" }),
    });
    expect(source.access_status).toBe("access_revoked");
    expect(source.error_message).toContain("AccessDenied");

    await handler({ mode: "probe" }, undefined, {
      probeSource: async () => ({ ok: true }),
    });
    expect(source.access_status).toBe("healthy");
    expect(source.error_message).toBeNull();
  });

  it("a passing probe leaves healthy/degraded sources untouched", async () => {
    const healthy = seedSource();
    const degraded = seedSource({
      id: "src-degraded",
      access_status: "degraded",
    });
    await handler({ mode: "probe" }, undefined, {
      probeSource: async () => ({ ok: true }),
    });
    expect(healthy.access_status).toBe("healthy");
    // degraded is the canary's verdict, not the probe's — only sync clears it.
    expect(degraded.access_status).toBe("degraded");
    expect(h.updates).toHaveLength(0);
  });

  it("CAS: a failing probe never flips a connect-time failed source", async () => {
    const failed = seedSource({ id: "src-failed", access_status: "failed" });
    await handler({ mode: "probe" }, undefined, {
      probeSource: async () => ({ ok: false, reason: "AccessDenied" }),
    });
    expect(failed.access_status).toBe("failed");
  });

  it("a throwing probe is treated as failure, not a crash", async () => {
    const source = seedSource();
    await handler({ mode: "probe" }, undefined, {
      probeSource: async () => {
        throw new Error("socket hang up");
      },
    });
    expect(source.access_status).toBe("access_revoked");
    expect(source.error_message).toContain("socket hang up");
  });
});

describe("sync mode", () => {
  it("dispatches once per KB with non-revoked s3-connect sources", async () => {
    seedSource(); // kb-1 healthy
    seedSource({ id: "src-2", knowledge_base_id: "kb-1" }); // same KB
    seedSource({
      id: "src-3",
      knowledge_base_id: "kb-2",
      access_status: "degraded",
    });
    seedSource({
      id: "src-4",
      knowledge_base_id: "kb-3",
      access_status: "access_revoked",
    });

    const dispatched: string[] = [];
    await handler({ mode: "sync" }, undefined, {
      dispatchSync: async (kbId) => {
        dispatched.push(kbId);
      },
    });
    // kb-1 deduped, kb-2 degraded still syncs (canary may recover), kb-3
    // revoked is excluded from sync until access is restored (R10).
    expect(dispatched.sort()).toEqual(["kb-1", "kb-2"]);
  });

  it("a dispatch failure throws (lands in the DLQ) after trying every KB", async () => {
    seedSource();
    seedSource({ id: "src-2", knowledge_base_id: "kb-2" });
    const dispatched: string[] = [];
    await expect(
      handler({ mode: "sync" }, undefined, {
        dispatchSync: async (kbId) => {
          dispatched.push(kbId);
          if (kbId === "kb-1") throw new Error("no arn");
        },
      }),
    ).rejects.toThrow(/no arn/);
    expect(dispatched.sort()).toEqual(["kb-1", "kb-2"]);
  });
});
