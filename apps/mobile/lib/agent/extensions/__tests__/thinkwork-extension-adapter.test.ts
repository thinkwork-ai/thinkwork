import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  defineExtension as defineThinkworkExtension,
  requireProvider,
} from "../../../../../../packages/pi-extensions/src/define-extension";
import { createAgentSession } from "../../session";
import { loadExtensions } from "../load-extensions";
import type { Logger } from "../types";
import {
  adaptThinkworkExtension,
  adaptThinkworkExtensions,
  thinkworkToolResultToMobile,
} from "../thinkwork-extension-adapter";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "../../providers/mock";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function sourcePath(): string {
  return fileURLToPath(
    new URL("../thinkwork-extension-adapter.ts", import.meta.url),
  );
}

describe("adaptThinkworkExtension", () => {
  it("registers a shared ThinkWork extension tool and prompt hook on mobile", async () => {
    const shared = defineThinkworkExtension({
      name: "thinkwork-shared-demo",
      toolNames: ["shared_echo"],
      register(pi) {
        pi.registerTool({
          name: "shared_echo",
          label: "Shared Echo",
          description: "Echo through a shared ThinkWork extension.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
          async execute(_toolCallId, params) {
            return {
              content: [
                {
                  type: "text",
                  text: `shared:${String((params as { value?: unknown }).value)}`,
                },
              ],
              details: { ok: true },
            };
          },
        });
        pi.on("before_agent_start", (event: { systemPrompt: string }) => ({
          systemPrompt: `${event.systemPrompt}\n\nShared extension loaded.`,
        }));
      },
    });
    const provider = new MockModelProvider([
      toolResponse("call-1", "shared_echo", { value: "ping" }),
      textResponse("done"),
    ]);
    const session = createAgentSession({
      modelProvider: provider,
      systemPrompt: "base",
      extensions: [adaptThinkworkExtension(shared)],
    });

    await session.ready();

    expect(session.tools.map((tool) => tool.name)).toEqual(["shared_echo"]);
    expect(session.systemPrompt).toBe("base\n\nShared extension loaded.");
    expect(session.tools[0].description).toBe(
      "Echo through a shared ThinkWork extension.",
    );
    expect(session.tools[0].parameters).toMatchObject({
      type: "object",
      required: ["value"],
    });

    const result = await session.prompt("go");
    expect(result.messages[2]).toMatchObject({
      role: "tool",
      name: "shared_echo",
      content: "shared:ping",
    });
  });

  it("preserves declared toolNames for host allowlist reasoning", () => {
    const shared = defineThinkworkExtension({
      name: "thinkwork-tools",
      toolNames: ["one", "two"],
      register() {},
    });

    const adapted = adaptThinkworkExtension(shared);

    expect(adapted.toolNames).toEqual(["one", "two"]);
    expect(adaptThinkworkExtensions([shared])[0].toolNames).toEqual([
      "one",
      "two",
    ]);
  });

  it("flattens shared Pi tool-result content blocks into mobile ToolResult text", () => {
    expect(
      thinkworkToolResultToMobile({
        content: [
          { type: "text", text: "first" },
          { type: "resource", resource: { text: "second" } },
          { type: "resource", resource: { uri: "file:///tmp/example.txt" } },
        ],
        isError: true,
      }),
    ).toEqual({
      content: "first\nsecond\nfile:///tmp/example.txt",
      isError: true,
    });
  });

  it("surfaces missing required providers during registration", async () => {
    const shared = defineThinkworkExtension({
      name: "needs-memory",
      toolNames: ["needs_memory"],
      register(_pi, providers) {
        requireProvider(providers, "memory", "needs-memory");
      },
    });
    const error = vi.fn();

    const loaded = await loadExtensions([adaptThinkworkExtension(shared)], {
      logger: { ...silentLogger, error },
    });

    expect(loaded.tools).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Extension "needs-memory" requires a "memory" provider',
      ),
    );
  });

  it("does not runtime-import upstream Pi or the shared package from the mobile adapter", () => {
    const source = readFileSync(sourcePath(), "utf8");

    expect(source).not.toMatch(/from ["']@earendil-works\/pi-coding-agent["']/);
    expect(source).not.toMatch(
      /^import\s+[^t][\s\S]*@thinkwork\/pi-extensions/m,
    );
  });
});
