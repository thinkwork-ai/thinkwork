import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  defineExtension,
  emptyToolParameters,
  requireProvider,
  toExtensionFactories,
  toExtensionFactory,
  type ProviderBundle,
  type ThinkworkExtension,
} from "../src/define-extension.js";

/** Minimal fake ExtensionAPI capturing tool + event-handler registrations. */
function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, unknown>();
  const api = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: (event: string, handler: unknown) => handlers.set(event, handler),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools, handlers };
}

describe("defineExtension", () => {
  it("returns a valid extension unchanged", () => {
    const ext: ThinkworkExtension = { name: "x", register: () => {} };
    expect(defineExtension(ext)).toBe(ext);
  });

  it("rejects a missing/empty name", () => {
    expect(() => defineExtension({ name: "", register: () => {} })).toThrow(
      /non-empty `name`/,
    );
    expect(() => defineExtension({ name: "   ", register: () => {} })).toThrow(
      /non-empty `name`/,
    );
  });

  it("rejects a missing register function", () => {
    expect(() =>
      defineExtension({ name: "x" } as unknown as ThinkworkExtension),
    ).toThrow(/missing a `register` function/);
  });

  it("rejects a non-object (null and primitives)", () => {
    expect(() =>
      defineExtension(undefined as unknown as ThinkworkExtension),
    ).toThrow(/requires an extension object/);
    expect(() =>
      defineExtension(null as unknown as ThinkworkExtension),
    ).toThrow(/requires an extension object/);
    expect(() =>
      defineExtension("nope" as unknown as ThinkworkExtension),
    ).toThrow(/requires an extension object/);
  });
});

describe("requireProvider", () => {
  it("returns the provider when present", () => {
    const memory = { recall: () => {}, reflect: () => {} };
    const providers = { memory } as unknown as ProviderBundle;
    expect(requireProvider(providers, "memory", "ext")).toBe(memory);
  });

  it("throws a descriptive, extension-named error when absent", () => {
    expect(() => requireProvider({}, "memory", "my-ext")).toThrow(
      /Extension "my-ext" requires a "memory" provider/,
    );
  });
});

describe("emptyToolParameters", () => {
  it("is a valid empty TypeBox object schema", () => {
    expect(emptyToolParameters.type).toBe("object");
    expect(emptyToolParameters.properties).toEqual({});
  });
});

describe("toExtensionFactory", () => {
  it("binds providers and registers against the live ExtensionAPI", async () => {
    const memory = { recall: vi.fn(), reflect: vi.fn() };
    const providers: ProviderBundle = { memory };
    let seenProviders: ProviderBundle | undefined;
    const ext = defineExtension({
      name: "capability",
      register(pi, p) {
        seenProviders = p;
        pi.registerTool({
          name: "do_thing",
          label: "Do Thing",
          description: "test tool",
          parameters: { type: "object", properties: {} } as never,
          execute: async () => ({ content: [], details: undefined }),
        });
        pi.on("session_start", () => {});
      },
    });

    const factory = toExtensionFactory(ext, providers);
    const { api, tools, handlers } = makeFakeApi();
    await factory(api);

    expect(seenProviders).toBe(providers);
    expect(tools.map((t) => t.name)).toEqual(["do_thing"]);
    expect(handlers.has("session_start")).toBe(true);
  });

  it("binds many extensions in declaration order", () => {
    const order: string[] = [];
    const a = defineExtension({
      name: "a",
      register: () => {
        order.push("a");
      },
    });
    const b = defineExtension({
      name: "b",
      register: () => {
        order.push("b");
      },
    });
    const factories = toExtensionFactories([a, b], {});
    const { api } = makeFakeApi();
    factories.forEach((f) => void f(api));
    expect(order).toEqual(["a", "b"]);
    expect(factories).toHaveLength(2);
  });

  it("returns an empty array for no extensions", () => {
    expect(toExtensionFactories([], {})).toEqual([]);
  });

  it("propagates a synchronous register throw to the host", () => {
    const ext = defineExtension({
      name: "boom",
      register: () => {
        throw new Error("register failed");
      },
    });
    const { api } = makeFakeApi();
    expect(() => toExtensionFactory(ext, {})(api)).toThrow("register failed");
  });

  it("returns (does not drop) an async register's promise so the host can await it", async () => {
    let resolved = false;
    const ext = defineExtension({
      name: "async",
      async register() {
        await Promise.resolve();
        resolved = true;
      },
    });
    const { api } = makeFakeApi();
    const pending = toExtensionFactory(ext, {})(api);
    expect(resolved).toBe(false); // not yet — proves the work is async
    await pending;
    expect(resolved).toBe(true); // and the factory returned the promise
  });

  it("propagates a rejected async register", async () => {
    const ext = defineExtension({
      name: "reject",
      register: async () => {
        throw new Error("async register failed");
      },
    });
    const { api } = makeFakeApi();
    await expect(toExtensionFactory(ext, {})(api)).rejects.toThrow(
      "async register failed",
    );
  });
});
