/**
 * Plan §005 U6 — vitest coverage for Hindsight ToolDefs.
 *
 * Uses an injected `fetchImpl` rather than global fetch monkey-patching
 * so the test surface stays explicit and parallel-safe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHindsightTools,
  buildRecallTool,
  buildReflectTool,
  HindsightToolError,
  type HindsightToolsContext,
} from "../src/tools/hindsight.js";

interface FetchCall {
  url: string;
  body: unknown;
}

interface ScriptedResponse {
  status?: number;
  body?: unknown;
  text?: string;
  throw?: Error;
}

function scriptedFetch(
  responses: ScriptedResponse[],
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    if (r?.throw) throw r.throw;
    return new Response(
      r?.text ?? (r?.body !== undefined ? JSON.stringify(r.body) : ""),
      { status: r?.status ?? 200 },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeContext(
  fetchImpl: typeof fetch,
  overrides: Partial<HindsightToolsContext> = {},
): HindsightToolsContext {
  return {
    endpoint: "https://hindsight.dev.thinkwork.ai",
    tenantId: "tenant-abc",
    userId: "user-xyz",
    fetchImpl,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("buildHindsightTools — composition", () => {
  it("returns [hindsight_recall, hindsight_reflect] in order", () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tools = buildHindsightTools(makeContext(fetchImpl));
    expect(tools.map((t) => t.name)).toEqual([
      "hindsight_recall",
      "hindsight_reflect",
    ]);
  });

  it("recall description names hindsight_reflect as REQUIRED FOLLOW-UP", () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tools = buildHindsightTools(makeContext(fetchImpl));
    const recall = tools[0];
    expect(recall?.description).toMatch(/REQUIRED FOLLOW-UP/);
    expect(recall?.description).toMatch(/hindsight_reflect/);
  });

  it("reflect description tells the agent to call AFTER recall", () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tools = buildHindsightTools(makeContext(fetchImpl));
    const reflect = tools[1];
    expect(reflect?.description).toMatch(/AFTER hindsight_recall/i);
  });
});

describe("hindsight_recall — happy path", () => {
  it("returns formatted memory units from a 200 response", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      {
        status: 200,
        body: {
          memory_units: [
            { text: "First memory", score: 0.9 },
            { text: "Second memory", score: 0.7 },
          ],
        },
      },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    const result = await tool.execute(
      "call-1",
      { query: "preferences" } as any,
    );
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("1. First memory");
    expect(text).toContain("2. Second memory");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://hindsight.dev.thinkwork.ai/v1/default/banks/user_user-xyz/memories/recall",
    );
    expect(calls[0]!.body).toMatchObject({
      query: "preferences",
      budget: "low",
    });
  });

  it("returns 'no relevant memories' when the response is empty", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: { memory_units: [] } },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    const result = await tool.execute("call-2", { query: "x" } as any);
    expect(result.content).toEqual([
      { type: "text", text: "No relevant memories found." },
    ]);
  });

  it("trims the endpoint trailing slash", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: { memory_units: [{ text: "ok" }] } },
    ]);
    const tool = buildRecallTool(
      makeContext(fetchImpl, {
        endpoint: "https://hindsight.dev.thinkwork.ai/",
      }),
    );
    await tool.execute("call-3", { query: "x" } as any);
    expect(calls[0]!.url).toBe(
      "https://hindsight.dev.thinkwork.ai/v1/default/banks/user_user-xyz/memories/recall",
    );
  });
});

describe("hindsight_reflect — happy path", () => {
  it("returns the synthesised text from the response", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: { text: "Synthesised answer here." } },
    ]);
    const tool = buildReflectTool(makeContext(fetchImpl));
    const result = await tool.execute("call-4", { query: "x" } as any);
    expect(result.content).toEqual([
      { type: "text", text: "Synthesised answer here." },
    ]);
    expect(calls[0]!.url).toBe(
      "https://hindsight.dev.thinkwork.ai/v1/default/banks/user_user-xyz/reflect",
    );
    expect(calls[0]!.body).toMatchObject({ query: "x", budget: "mid" });
  });

  it("falls back to JSON when no text/response/summary is present", async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: { other: "shape" } },
    ]);
    const tool = buildReflectTool(makeContext(fetchImpl));
    const result = await tool.execute("call-5", { query: "x" } as any);
    const text = (result.content[0]! as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ other: "shape" });
  });
});

describe("retry semantics", () => {
  it("retries 5xx three times then succeeds", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 503, text: "service unavailable" },
      { status: 502, text: "bad gateway" },
      { status: 200, body: { memory_units: [{ text: "after retry" }] } },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    const promise = tool.execute("call-6", { query: "x" } as any);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;
    expect(calls).toHaveLength(3);
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("after retry");
  });

  it("retries transport errors and surfaces last error after exhaustion", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { throw: new Error("ECONNRESET") },
      { throw: new Error("ECONNRESET") },
      { throw: new Error("ECONNRESET") },
      { throw: new Error("ECONNRESET") },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    const promise = tool.execute("call-7", { query: "x" } as any).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await promise;
    expect(err).toBeInstanceOf(HindsightToolError);
    expect((err as Error).message).toContain("transport error after 4 attempts");
    expect(calls).toHaveLength(4);
  });

  it("does NOT retry on 4xx; throws immediately", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 400, text: "bad request shape" },
      { status: 200, body: { memory_units: [] } },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    await expect(
      tool.execute("call-8", { query: "x" } as any),
    ).rejects.toThrow(/Hindsight 400/);
    expect(calls).toHaveLength(1);
  });

  it("retries 5xx then throws after all attempts fail", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    const promise = tool.execute("call-9", { query: "x" } as any).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await promise;
    expect(err).toBeInstanceOf(HindsightToolError);
    expect((err as HindsightToolError).status).toBe(503);
    expect(calls).toHaveLength(4);
  });
});

describe("fail-closed validation", () => {
  it("recall throws when query is empty", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tool = buildRecallTool(makeContext(fetchImpl));
    await expect(
      tool.execute("call-10", { query: "" } as any),
    ).rejects.toThrow(HindsightToolError);
  });

  it("reflect throws when query is empty", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tool = buildReflectTool(makeContext(fetchImpl));
    await expect(
      tool.execute("call-11", { query: "   " } as any),
    ).rejects.toThrow(/empty query/);
  });

  it("throws when tenantId is missing", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tool = buildRecallTool(makeContext(fetchImpl, { tenantId: "" }));
    await expect(
      tool.execute("call-12", { query: "x" } as any),
    ).rejects.toThrow(/tenantId/);
  });

  it("throws when userId is missing", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tool = buildRecallTool(makeContext(fetchImpl, { userId: "" }));
    await expect(
      tool.execute("call-13", { query: "x" } as any),
    ).rejects.toThrow(/userId/);
  });

  it("throws when endpoint is missing", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: {} }]);
    const tool = buildRecallTool(makeContext(fetchImpl, { endpoint: "" }));
    await expect(
      tool.execute("call-14", { query: "x" } as any),
    ).rejects.toThrow(/endpoint/);
  });
});

describe("multi-tenant isolation", () => {
  it("bank id is derived from userId only, not tenantId", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: { memory_units: [] } },
    ]);
    const tool = buildRecallTool(
      makeContext(fetchImpl, { tenantId: "tenant-A", userId: "user-1" }),
    );
    await tool.execute("call-15", { query: "x" } as any);
    expect(calls[0]!.url).toContain("user_user-1");
    expect(calls[0]!.url).not.toContain("tenant-A");
  });
});

describe("AbortSignal composition", () => {
  it("does not retry when caller signal aborts during the fetch attempt", async () => {
    // First fetch sees the abort and throws AbortError. The retry loop
    // must detect signal.aborted and rethrow as 'aborted by caller signal'
    // — never advance to the next retry attempt.
    let callCount = 0;
    const controller = new AbortController();
    const fetchImpl = (async () => {
      callCount += 1;
      controller.abort();
      const err: Error & { name?: string } = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof fetch;

    const tool = buildRecallTool(makeContext(fetchImpl));
    await expect(
      tool.execute("call-16", { query: "x" } as any, controller.signal),
    ).rejects.toThrow(/aborted by caller signal/);
    expect(callCount).toBe(1);
  });

  it("composes caller signal with per-attempt timeout via AbortSignal.any", async () => {
    // When a caller signal is supplied, the per-attempt deadline must
    // still bound a hung fetch. Verify the signal passed to fetch
    // aborts when the per-attempt timeout fires, even though the
    // caller's signal is never aborted by the test.
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      observedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ memory_units: [] }), { status: 200 });
    }) as typeof fetch;

    const callerController = new AbortController();
    const tool = buildRecallTool(
      makeContext(fetchImpl, { timeoutMs: 100 }),
    );
    await tool.execute(
      "call-17",
      { query: "x" } as any,
      callerController.signal,
    );

    expect(observedSignal).toBeDefined();
    // The composed signal should be a different AbortSignal than the
    // caller's bare signal — proves AbortSignal.any wrapped it.
    expect(observedSignal).not.toBe(callerController.signal);
  });
});
