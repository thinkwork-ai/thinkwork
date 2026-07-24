/**
 * connectKnowledgeBaseSource resolver tests (external S3 KB source U4).
 *
 * The manager Lambda is mocked at the dispatch seam: these tests pin the
 * resolver's contract — synchronous RequestResponse dispatch with errors
 * surfaced verbatim (AE2/R9), fast-fail validation, authz gating, and the
 * wire shape of the returned source row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, state, reset } = vi.hoisted(() => {
  const calls = {
    syncDispatches: [] as { action: string; kbId: string; extra: unknown }[],
    eventDispatches: [] as string[],
    selectQueue: [] as unknown[][],
  };
  const state = {
    dispatchError: null as string | null,
    authzThrow: false,
  };
  return {
    calls,
    state,
    reset: () => {
      calls.syncDispatches.length = 0;
      calls.eventDispatches.length = 0;
      calls.selectQueue.length = 0;
      state.dispatchError = null;
      state.authzThrow = false;
    },
  };
});

vi.mock("../../utils.js", () => ({
  knowledgeBases: {
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
  },
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(calls.selectQueue.shift() ?? [{ tenant_id: "t1" }]),
      }),
    }),
  },
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  snakeToCamel: (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    }
    return out;
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: () =>
    state.authzThrow
      ? Promise.reject(new Error("Not authorized"))
      : Promise.resolve(),
}));

vi.mock("./kb-manager-dispatch.js", () => ({
  dispatchKbManager: (action: string) => {
    calls.eventDispatches.push(action);
    return Promise.resolve();
  },
  dispatchKbManagerSync: (action: string, kbId: string, extra: unknown) => {
    calls.syncDispatches.push({ action, kbId, extra });
    if (state.dispatchError) {
      return Promise.reject(new Error(state.dispatchError));
    }
    return Promise.resolve({ sourceId: "src-1" });
  },
}));

import { connectKnowledgeBaseSource } from "./connectKnowledgeBaseSource.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

const input = {
  knowledgeBaseId: "kb-1",
  bucket: "cx-to-s3",
  prefix: "cx/files/",
  exclude: ["*Retired Procedures/*"],
};

const sourceRow = {
  id: "src-1",
  tenant_id: "t1",
  knowledge_base_id: "kb-1",
  kind: "s3-connect",
  bucket: "cx-to-s3",
  prefix: "cx/files/",
  filter_patterns: { include: [], exclude: ["*Retired Procedures/*"] },
  access_status: "pending",
};

beforeEach(reset);

describe("connectKnowledgeBaseSource", () => {
  it("happy path: dispatches connect_source RequestResponse and returns the source row", async () => {
    calls.selectQueue.push([{ tenant_id: "t1" }], [sourceRow]);
    const result = await connectKnowledgeBaseSource(null, { input }, ctx);

    expect(calls.syncDispatches).toHaveLength(1);
    expect(calls.syncDispatches[0]).toMatchObject({
      action: "connect_source",
      kbId: "kb-1",
      extra: {
        connect: {
          bucket: "cx-to-s3",
          prefix: "cx/files/",
          include: [],
          exclude: ["*Retired Procedures/*"],
          bucketOwnerAccountId: null,
        },
      },
    });
    // Contrast with the legacy Event path: connect never fire-and-forgets.
    expect(calls.eventDispatches).toHaveLength(0);
    expect(result).toMatchObject({
      id: "src-1",
      kind: "s3-connect",
      accessStatus: "pending",
    });
    // AWSJSON field is a JSON-encoded string on the wire.
    expect(result.filterPatterns).toBe(
      JSON.stringify({ include: [], exclude: ["*Retired Procedures/*"] }),
    );
  });

  it("AE2: a manager preflight failure propagates verbatim and returns no row", async () => {
    state.dispatchError =
      "Preflight failed: KB service role arn:aws:iam::1:role/kb cannot s3:ListBucket on cx-to-s3";
    await expect(
      connectKnowledgeBaseSource(null, { input }, ctx),
    ).rejects.toThrow(/cannot s3:ListBucket/);
  });

  it("AE6: a cross-account rejection from the manager propagates", async () => {
    state.dispatchError =
      "Cross-account buckets are not yet supported (bucket owner 999999999999, stack account 111111111111)";
    await expect(
      connectKnowledgeBaseSource(
        null,
        { input: { ...input, bucketOwnerAccountId: "999999999999" } },
        ctx,
      ),
    ).rejects.toThrow(/not yet supported/);
  });

  it("rejects >25 patterns without dispatching", async () => {
    await expect(
      connectKnowledgeBaseSource(
        null,
        {
          input: {
            ...input,
            exclude: Array.from({ length: 26 }, (_, i) => `*p${i}*`),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/At most 25/);
    expect(calls.syncDispatches).toHaveLength(0);
  });

  it("rejects a non-authorized caller before dispatching", async () => {
    state.authzThrow = true;
    await expect(
      connectKnowledgeBaseSource(null, { input }, ctx),
    ).rejects.toThrow(/Not authorized/);
    expect(calls.syncDispatches).toHaveLength(0);
  });

  it("404s on an unknown knowledge base", async () => {
    calls.selectQueue.push([]);
    await expect(
      connectKnowledgeBaseSource(null, { input }, ctx),
    ).rejects.toThrow(/not found/);
  });
});
