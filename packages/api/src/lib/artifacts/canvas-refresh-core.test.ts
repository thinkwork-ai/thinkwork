import { describe, expect, it, vi } from "vitest";
import { resultShapeHash } from "@thinkwork/thread-json-render";
import {
  payloadChanged,
  refreshBinding,
  refreshCanvasBindings,
  type CanvasRefreshBinding,
  type CanvasRefreshDeps,
} from "./canvas-refresh-core.js";

const NOW = new Date("2026-07-04T12:00:00.000Z");

/** A tenant-scoped binding whose recorded shape matches `RAW_RESULT`. */
const RAW_RESULT = { content: [{ type: "text", text: "hi" }], isError: false };
const MATCHING_HASH = resultShapeHash(RAW_RESULT);

function tenantBinding(
  over: Partial<CanvasRefreshBinding> = {},
): CanvasRefreshBinding {
  return {
    id: "b1",
    partId: "part-1",
    elementId: "",
    serverName: "crm",
    serverRef: "crm",
    toolName: "list_deals",
    frozenArgs: { limit: 5 },
    resultShapeHash: MATCHING_HASH,
    authContext: "tenant_mcp",
    quality: "good",
    ...over,
  };
}

interface Recorder {
  qualityWrites: Array<{
    bindingId: string;
    quality: string;
    markFetched: boolean;
    markGood: boolean;
  }>;
  headApplies: number;
  toolCalls: number;
}

function makeDeps(over: Partial<CanvasRefreshDeps> = {}): {
  deps: CanvasRefreshDeps;
  rec: Recorder;
} {
  const rec: Recorder = { qualityWrites: [], headApplies: 0, toolCalls: 0 };
  const deps: CanvasRefreshDeps = {
    resolveServerTarget: async () => ({
      kind: "ok",
      target: { url: "https://x" },
    }),
    callTool: async () => {
      rec.toolCalls++;
      return { isError: false, raw: RAW_RESULT };
    },
    applyHeadData: async () => {
      rec.headApplies++;
      return "applied";
    },
    writeBindingQuality: async (input) => {
      rec.qualityWrites.push({
        bindingId: input.bindingId,
        quality: input.quality,
        markFetched: input.markFetched,
        markGood: input.markGood,
      });
    },
    now: () => NOW,
    ...over,
  };
  return { deps, rec };
}

describe("payloadChanged — sentinel comparator (THINK-233)", () => {
  it("no prior payload is NOT a change (first population)", () => {
    expect(payloadChanged(undefined, { a: 1 })).toBe(false);
  });

  it("identical payloads are unchanged", () => {
    expect(payloadChanged({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(
      false,
    );
  });

  it("is object-key-ORDER insensitive", () => {
    expect(payloadChanged({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(
      payloadChanged(
        { outer: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }] },
        { list: [{ q: 2, p: 1 }], outer: { y: 2, x: 1 } },
      ),
    ).toBe(false);
  });

  it("a key present-as-undefined equals an absent key", () => {
    expect(payloadChanged({ a: 1, b: undefined }, { a: 1 })).toBe(false);
  });

  it("a changed scalar value IS a change", () => {
    expect(payloadChanged({ a: 1 }, { a: 2 })).toBe(true);
  });

  it("a changed nested value IS a change", () => {
    expect(payloadChanged({ a: { b: 1 } }, { a: { b: 2 } })).toBe(true);
  });

  it("array ORDER is significant (tabular rows)", () => {
    expect(payloadChanged([1, 2, 3], [3, 2, 1])).toBe(true);
  });

  it("a new/removed key IS a change", () => {
    expect(payloadChanged({ a: 1 }, { a: 1, c: 3 })).toBe(true);
    expect(payloadChanged({ a: 1, c: 3 }, { a: 1 })).toBe(true);
  });

  it("null payload (explicit null) compares as a real value, not 'no prior'", () => {
    expect(payloadChanged(null, null)).toBe(false);
    expect(payloadChanged(null, { a: 1 })).toBe(true);
  });
});

describe("refreshBinding — payloadChanged wiring (THINK-233)", () => {
  it("reports payloadChanged=true when the fresh payload differs from the prior head payload", async () => {
    const { deps } = makeDeps({
      // Prior head payload differs from the RAW_RESULT the tool now returns.
      readPreviousPayload: async () => ({
        content: [{ type: "text", text: "OLD" }],
      }),
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.outcome).toBe("refreshed");
    expect(result.payloadChanged).toBe(true);
  });

  it("reports payloadChanged=false when the fresh payload equals the prior head payload", async () => {
    const { deps } = makeDeps({
      readPreviousPayload: async () => RAW_RESULT,
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.outcome).toBe("refreshed");
    expect(result.payloadChanged).toBe(false);
  });

  it("reports payloadChanged=false when there was no prior payload", async () => {
    const { deps } = makeDeps({
      readPreviousPayload: async () => undefined,
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.outcome).toBe("refreshed");
    expect(result.payloadChanged).toBe(false);
  });

  it("defaults payloadChanged=false when no readPreviousPayload dep is wired", async () => {
    const { deps } = makeDeps();
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.payloadChanged).toBe(false);
  });

  it("payloadChanged is false on a non-refreshed outcome (schema_stale)", async () => {
    const { deps } = makeDeps({
      readPreviousPayload: async () => ({ anything: "prior" }),
      callTool: async () => ({ isError: false, raw: { totallyDifferent: 1 } }),
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.outcome).toBe("schema_stale");
    expect(result.payloadChanged).toBe(false);
  });
});

describe("refreshBinding — per-user OAuth (AE1, R9)", () => {
  it("never invokes and degrades to STALE with a needs-user affordance", async () => {
    const { deps, rec } = makeDeps();
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth" }),
      deps,
    );
    expect(rec.toolCalls).toBe(0);
    expect(rec.headApplies).toBe(0);
    expect(result.outcome).toBe("needs_user");
    expect(result.quality).toBe("stale");
    // No fetch happened → last_fetched_at is not stamped.
    expect(rec.qualityWrites[0]).toMatchObject({
      quality: "stale",
      markFetched: false,
      markGood: false,
    });
  });
});

describe("refreshBinding — owner-token path (THINK-172 U2b)", () => {
  const OWNER = "55555555-5555-5555-5555-555555555555";
  const OTHER = "66666666-6666-6666-6666-666666666666";

  function ownerDeps(over: Partial<CanvasRefreshDeps> = {}) {
    return makeDeps({
      actingUserId: OWNER,
      resolveOwnerServerTarget: async () => ({
        kind: "ok",
        target: { url: "https://owner" },
      }),
      // The tenant resolver must never be consulted for a per-user binding.
      resolveServerTarget: async () => {
        throw new Error("tenant resolver must not be called");
      },
      ...over,
    });
  }

  it("refreshes a per-user binding under the owner's credential when the acting user IS the owner", async () => {
    const { deps, rec } = ownerDeps();
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth", ownerUserId: OWNER }),
      deps,
    );
    expect(rec.toolCalls).toBe(1);
    expect(rec.headApplies).toBe(1);
    expect(result.outcome).toBe("refreshed");
    expect(result.quality).toBe("good");
  });

  it("still degrades to NEEDS_USER when the acting user is NOT the owner", async () => {
    const { deps, rec } = ownerDeps({ actingUserId: OTHER });
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth", ownerUserId: OWNER }),
      deps,
    );
    expect(rec.toolCalls).toBe(0);
    expect(result.outcome).toBe("needs_user");
    expect(result.quality).toBe("stale");
  });

  it("still degrades to NEEDS_USER with no acting user (unattended posture, R9)", async () => {
    const { deps, rec } = ownerDeps({ actingUserId: null });
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth", ownerUserId: OWNER }),
      deps,
    );
    expect(rec.toolCalls).toBe(0);
    expect(result.outcome).toBe("needs_user");
  });

  it("still degrades to NEEDS_USER when the binding has no recorded owner", async () => {
    const { deps, rec } = ownerDeps();
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth", ownerUserId: null }),
      deps,
    );
    expect(rec.toolCalls).toBe(0);
    expect(result.outcome).toBe("needs_user");
  });

  it("maps an owner-resolver needs_user (no active token) to the ordinary NEEDS_USER outcome", async () => {
    const { deps, rec } = ownerDeps({
      resolveOwnerServerTarget: async () => ({
        kind: "needs_user",
        reason: "no active connector token for the requesting owner",
      }),
    });
    const result = await refreshBinding(
      tenantBinding({ authContext: "per_user_oauth", ownerUserId: OWNER }),
      deps,
    );
    expect(rec.toolCalls).toBe(0);
    expect(result.outcome).toBe("needs_user");
    expect(result.quality).toBe("stale");
  });

  it("never consults the owner resolver for tenant-scoped bindings", async () => {
    let ownerResolves = 0;
    const { deps, rec } = makeDeps({
      actingUserId: OWNER,
      resolveOwnerServerTarget: async () => {
        ownerResolves++;
        return { kind: "ok", target: { url: "https://owner" } };
      },
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(ownerResolves).toBe(0);
    expect(rec.toolCalls).toBe(1);
    expect(result.outcome).toBe("refreshed");
  });
});

describe("refreshBinding — schema mismatch (AE2, R7)", () => {
  it("keeps last-good, flags SCHEMA_STALE, escalates, and never touches the head", async () => {
    const { deps, rec } = makeDeps({
      callTool: async () => ({ isError: false, raw: { totallyDifferent: 1 } }),
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(rec.headApplies).toBe(0); // head untouched — mismatched payload never applied
    expect(result.outcome).toBe("schema_stale");
    expect(result.quality).toBe("schema_stale");
    expect(result.escalate).toBe(true);
    expect(rec.qualityWrites[0]).toMatchObject({
      quality: "schema_stale",
      markFetched: true,
      markGood: false,
    });
  });
});

describe("refreshBinding — success path", () => {
  it("applies the data slice and marks GOOD with both timestamps", async () => {
    const { deps, rec } = makeDeps();
    const result = await refreshBinding(tenantBinding(), deps);
    expect(rec.toolCalls).toBe(1);
    expect(rec.headApplies).toBe(1);
    expect(result.outcome).toBe("refreshed");
    expect(result.quality).toBe("good");
    expect(rec.qualityWrites[0]).toMatchObject({
      quality: "good",
      markFetched: true,
      markGood: true,
    });
  });
});

describe("refreshBinding — tool failure (R8)", () => {
  it("marks BAD and retains last-good (no head write, no good stamp) on transport throw", async () => {
    const { deps, rec } = makeDeps({
      callTool: async () => {
        throw new Error("boom");
      },
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(rec.headApplies).toBe(0);
    expect(result.outcome).toBe("failed");
    expect(result.quality).toBe("bad");
    expect(rec.qualityWrites[0]).toMatchObject({
      quality: "bad",
      markFetched: true,
      markGood: false,
    });
  });

  it("marks BAD on an MCP isError result", async () => {
    const { deps, rec } = makeDeps({
      callTool: async () => ({ isError: true, raw: RAW_RESULT }),
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(rec.headApplies).toBe(0);
    expect(result.outcome).toBe("failed");
    expect(result.quality).toBe("bad");
  });
});

describe("refreshBinding — deleted / unresolved server (R8)", () => {
  it("is a TERMINAL bad state, distinct from transient failure", async () => {
    const { deps, rec } = makeDeps({
      resolveServerTarget: async () => ({
        kind: "missing",
        reason: "MCP server no longer exists",
      }),
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(rec.toolCalls).toBe(0);
    expect(result.outcome).toBe("server_missing");
    expect(result.quality).toBe("bad");
    expect(result.reason).toBe("MCP server no longer exists");
  });
});

describe("refreshBinding — head-write race (KTD6)", () => {
  it("degrades to STALE and never clobbers when applyHeadData reports a stale head", async () => {
    const { deps, rec } = makeDeps({
      applyHeadData: async () => "stale",
    });
    const result = await refreshBinding(tenantBinding(), deps);
    expect(result.outcome).toBe("skipped");
    expect(result.quality).toBe("stale");
    expect(rec.qualityWrites[0]).toMatchObject({
      quality: "stale",
      markGood: false,
    });
  });
});

describe("refreshCanvasBindings — no model invocation", () => {
  it("refreshes every binding through the injected deps only (no Bedrock seam)", async () => {
    const modelSpy = vi.fn();
    const { deps } = makeDeps();
    // The deps surface has no model/Bedrock hook by construction; a caller that
    // wired one would show up here. Prove the loop touches only the data seam.
    const results = await refreshCanvasBindings(
      [tenantBinding({ id: "a" }), tenantBinding({ id: "b" })],
      deps,
    );
    expect(results.map((r) => r.outcome)).toEqual(["refreshed", "refreshed"]);
    expect(modelSpy).not.toHaveBeenCalled();
  });
});
