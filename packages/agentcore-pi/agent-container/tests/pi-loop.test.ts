import { describe, expect, it, vi } from "vitest";

type Subscriber = (event: {
  type: "tool_execution_start" | "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}) => void;

const subscribers = vi.hoisted(() => [] as Subscriber[]);

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn((_provider: string, id: string) => ({ id })),
  streamSimple: vi.fn(),
}));

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    };

    constructor(readonly config: unknown) {}

    subscribe(subscriber: Subscriber) {
      subscribers.push(subscriber);
    }

    async prompt() {
      for (const subscriber of subscribers) {
        subscriber({
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "web_search",
          args: { query: "OpenAI" },
        });
        subscriber({
          type: "tool_execution_end",
          toolCallId: "tool-1",
          toolName: "web_search",
          result: { details: { result_count: 1 } },
          isError: false,
        });
      }
    }
  },
}));

import { runPiAgent } from "../src/runtime/pi-loop.js";

describe("runPiAgent", () => {
  it("returns tool call metadata at the top level and response level", async () => {
    subscribers.length = 0;

    const result = await runPiAgent(
      {
        message: "search",
        model: "anthropic.test-model",
        web_search_config: { provider: "exa", apiKey: "key" },
      },
      {
        awsRegion: "us-east-1",
        gitSha: "sha",
        buildTime: "now",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
      },
    );

    expect(result.tools_called).toEqual(["web_search"]);
    expect(result.response.tools_called).toEqual(["web_search"]);
    expect(result.tool_invocations?.[0]).toMatchObject({
      id: "tool-1",
      name: "web_search",
      args: { query: "OpenAI" },
      result: { details: { result_count: 1 } },
      is_error: false,
      runtime: "pi",
      source: "builtin",
    });
    expect(result.response.tool_invocations).toEqual(result.tool_invocations);
  });

  it("does not auto-retain every turn in Hindsight", async () => {
    subscribers.length = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ retained: true })));

    const result = await runPiAgent(
      {
        message: "remember cobalt",
        model: "anthropic.test-model",
        use_memory: true,
        hindsight_endpoint: "https://hindsight.test",
        thread_id: "thread-1",
        user_id: "user-1",
      },
      {
        awsRegion: "us-east-1",
        gitSha: "sha",
        buildTime: "now",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tools_called).toEqual(["web_search"]);
    expect(result.hindsight_usage).toEqual([]);
    expect(result.tool_invocations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "hindsight_retain" }),
      ]),
    );

    fetchMock.mockRestore();
  });
});
