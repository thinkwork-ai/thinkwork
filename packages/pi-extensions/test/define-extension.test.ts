import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  defineExtension,
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

  it("rejects a non-object", () => {
    expect(() =>
      defineExtension(undefined as unknown as ThinkworkExtension),
    ).toThrow(/requires an extension object/);
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
});
