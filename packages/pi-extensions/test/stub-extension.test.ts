import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  toExtensionFactory,
  type ProviderBundle,
} from "../src/define-extension.js";
import { stubExtension } from "../src/stub-extension.js";

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const api = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    on: (event: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  return { api, tools, handlers };
}

describe("stubExtension", () => {
  it("has a stable kebab-case name", () => {
    expect(stubExtension.name).toBe("thinkwork-stub");
  });

  it("registers the ping tool and a session_start hook against a fake provider bundle", async () => {
    const providers: ProviderBundle = {};
    const { api, tools, handlers } = makeFakeApi();
    await toExtensionFactory(stubExtension, providers)(api);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("thinkwork_ping");
    expect(handlers.has("session_start")).toBe(true);
  });

  it("ping tool returns pong", async () => {
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(stubExtension, {})(api);
    const result = await tools[0].execute(
      "call-1",
      {},
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
  });

  it("session_start hook is a no-op that tolerates a missing memory provider", async () => {
    const { api, handlers } = makeFakeApi();
    await toExtensionFactory(stubExtension, {})(api);
    const hook = handlers.get("session_start")!;
    await expect((hook as () => Promise<void>)()).resolves.toBeUndefined();
  });

  it("constructs in isolation with no concrete AWS/Bedrock/Hindsight client", async () => {
    // The whole point of the provider seam: a fake bundle with plain mocks, no
    // real clients, drives the extension end-to-end.
    const memory = { recall: vi.fn(), reflect: vi.fn() };
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(stubExtension, { memory })(api);
    expect(tools[0].name).toBe("thinkwork_ping");
    expect(memory.recall).not.toHaveBeenCalled();
  });
});
