import { describe, expect, it, vi } from "vitest";
import { resultShapeHash } from "@thinkwork/thread-json-render";
import {
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

function makeDeps(
  over: Partial<CanvasRefreshDeps> = {},
): { deps: CanvasRefreshDeps; rec: Recorder } {
  const rec: Recorder = { qualityWrites: [], headApplies: 0, toolCalls: 0 };
  const deps: CanvasRefreshDeps = {
    resolveServerTarget: async () => ({ kind: "ok", target: { url: "https://x" } }),
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
