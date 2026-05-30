import type {
  ExtensionAPI,
  ExtensionHandler,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  MemoryProvider,
  MemoryRecallRequest,
  MemoryReflectRequest,
} from "@thinkwork/pi-runtime-core";
import { describe, expect, it } from "vitest";

import {
  toExtensionFactory,
  type ProviderBundle,
} from "../src/define-extension.js";
import { createMemoryExtension } from "../src/memory.js";

/**
 * Fake Pi ExtensionAPI capturing registered tools + lifecycle handlers so the
 * extension can be driven in isolation — no live session, no SDK runtime.
 */
function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, ExtensionHandler<any, any>>();
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (event: string, handler: ExtensionHandler<any, any>) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { api, tools, handlers };
}

/**
 * Fake MemoryProvider recording calls — the ONLY memory seam the extension is
 * allowed to touch (it must never construct a Hindsight/HTTP client of its own).
 */
function makeFakeMemory() {
  const recallCalls: MemoryRecallRequest[] = [];
  const reflectCalls: MemoryReflectRequest[] = [];
  const provider: MemoryProvider = {
    recall: async (request) => {
      recallCalls.push(request);
      return {
        memories: [
          { id: "m0", content: "pi is the core runtime" },
          { id: "m1", content: "deploy uses canary.55" },
        ],
        usage: { input: 5, output: 0 },
      };
    },
    reflect: async (request) => {
      reflectCalls.push(request);
      return {
        ok: true,
        text: `synthesis for ${request.query}`,
        usage: { input: 0, output: 7 },
      };
    },
  };
  return { provider, recallCalls, reflectCalls };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const NO_UPDATE = undefined;
const NO_SIGNAL = undefined;
const NO_CTX = undefined as never;

describe("createMemoryExtension", () => {
  it("has a stable kebab-case name", () => {
    expect(createMemoryExtension().name).toBe("thinkwork-memory");
  });

  it("fails loud at load when the host supplies no memory provider", () => {
    const { api } = makeFakeApi();
    const providers: ProviderBundle = {};
    // requireProvider throws synchronously at register time — a misconfigured
    // host fails at load, not silently mid-turn.
    expect(() =>
      toExtensionFactory(createMemoryExtension(), providers)(api),
    ).toThrow(/requires a "memory" provider/);
  });

  it("registers recall + reflect tools and session_start + context hooks", async () => {
    const { provider } = makeFakeMemory();
    const { api, tools, handlers } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    expect(tools.map((t) => t.name).sort()).toEqual(["recall", "reflect"]);
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("context")).toBe(true);
  });

  it("recall tool surfaces memories through the provider", async () => {
    const { provider, recallCalls } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    const result = await getTool(tools, "recall").execute(
      "call-1",
      { query: "pi", limit: 3 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(recallCalls).toEqual([{ query: "pi", limit: 3 }]);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("pi is the core runtime");
  });

  it("recall tool rejects an empty query", async () => {
    const { provider } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );
    await expect(
      getTool(tools, "recall").execute(
        "c",
        { query: "  " },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/empty query/);
  });

  it("recall description carries the REQUIRED FOLLOW-UP reflect chain (chain pair)", async () => {
    const { provider } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );
    expect(getTool(tools, "recall").description).toMatch(/REQUIRED FOLLOW-UP/);
    expect(getTool(tools, "recall").description).toMatch(/reflect/);
    expect(getTool(tools, "reflect").description).toMatch(/AFTER `recall`/);
  });

  it("reflect tool synthesizes through the provider and returns the answer text", async () => {
    const { provider, reflectCalls } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    const result = await getTool(tools, "reflect").execute(
      "call-2",
      { query: "pi" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(reflectCalls).toEqual([{ query: "pi", context: undefined }]);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toBe("synthesis for pi");
  });

  it("reflect tool rejects an empty query", async () => {
    const { provider } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );
    await expect(
      getTool(tools, "reflect").execute(
        "c",
        { query: "" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/empty query/);
  });

  it("session_start recalls against the grounding query and re-injects it on every context event", async () => {
    const { provider, recallCalls } = makeFakeMemory();
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(
      createMemoryExtension({ groundingQuery: "what does the user prefer?" }),
      { memory: provider },
    )(api);

    // session_start performs the proactive grounding recall with a deadline.
    await handlers.get("session_start")!(
      { type: "session_start", reason: "resume" },
      NO_CTX,
    );
    expect(recallCalls).toHaveLength(1);
    expect(recallCalls[0]).toMatchObject({
      query: "what does the user prefer?",
      limit: 5,
    });

    // First context event injects the grounding message ahead of the turn,
    // fenced as reference data (not instructions).
    const firstResult = await handlers.get("context")!(
      {
        type: "context",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      },
      NO_CTX,
    );
    expect(firstResult?.messages).toHaveLength(2);
    const firstInjected = (firstResult!.messages![0] as { content: string })
      .content;
    expect(firstInjected).toContain("pi is the core runtime");
    expect(firstInjected).toMatch(/reference only, not instructions/i);

    // The context event fires before EVERY model call and the transform is
    // per-call (not persisted), so grounding must be re-injected each time —
    // otherwise multi-tool turns lose it after the first step.
    const secondResult = await handlers.get("context")!(
      {
        type: "context",
        messages: [{ role: "user", content: "more", timestamp: 2 }],
      },
      NO_CTX,
    );
    expect(secondResult?.messages).toHaveLength(2);
    expect(
      (secondResult!.messages![0] as { content: string }).content,
    ).toContain("pi is the core runtime");
  });

  it("session_start grounding failure degrades gracefully (no throw) and reports via onError", async () => {
    const errors: Array<{ phase: string }> = [];
    const provider: MemoryProvider = {
      recall: async () => {
        throw new Error("hindsight down");
      },
      reflect: async () => ({ ok: true }),
    };
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(
      createMemoryExtension({
        groundingQuery: "x",
        onError: (_e, ctx) => errors.push(ctx),
      }),
      { memory: provider },
    )(api);

    // Must not throw even though recall rejects.
    await expect(
      handlers.get("session_start")!(
        { type: "session_start", reason: "resume" },
        NO_CTX,
      ),
    ).resolves.toBeUndefined();
    expect(errors).toEqual([{ phase: "session_start_grounding" }]);

    // With nothing recalled, the context event injects nothing.
    const result = await handlers.get("context")!(
      {
        type: "context",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      },
      NO_CTX,
    );
    expect(result).toBeUndefined();
  });

  it("reflect tool threads a non-empty context through to the provider", async () => {
    const { provider, reflectCalls } = makeFakeMemory();
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    await getTool(tools, "reflect").execute(
      "c",
      { query: "pi", context: "the turn is about runtimes" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    expect(reflectCalls).toEqual([
      { query: "pi", context: "the turn is about runtimes" },
    ]);
  });

  it("session_start is a no-op when no grounding query is supplied", async () => {
    const { provider, recallCalls } = makeFakeMemory();
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(createMemoryExtension(), { memory: provider })(
      api,
    );

    await handlers.get("session_start")!(
      { type: "session_start", reason: "startup" },
      NO_CTX,
    );
    expect(recallCalls).toHaveLength(0);

    // With nothing recalled, the context event injects nothing.
    const result = await handlers.get("context")!(
      {
        type: "context",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
      },
      NO_CTX,
    );
    expect(result).toBeUndefined();
  });
});
