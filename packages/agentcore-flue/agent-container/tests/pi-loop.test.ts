import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { __setLambdaClientForTest } from "../src/runtime/tools/hindsight.js";

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
      runtime: "flue",
      source: "builtin",
    });
    expect(result.response.tool_invocations).toEqual(result.tool_invocations);
  });

  describe("Flue auto-retain wiring", () => {
    let mockLambda: LambdaClient;
    // `send` is overloaded on the AWS SDK client; vi.spyOn's generic
    // constraint on M doesn't model overloaded callable signatures.
    // Type the spy loosely; runtime assertions pin the contract.
    let lambdaSendSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      subscribers.length = 0;
      mockLambda = new LambdaClient({ region: "us-east-1" });
      lambdaSendSpy = vi
        .spyOn(mockLambda, "send" as never)
        .mockResolvedValue({} as never) as unknown as ReturnType<typeof vi.fn>;
      __setLambdaClientForTest(mockLambda);
      process.env.MEMORY_RETAIN_FN_NAME = "memory-retain-dev";
    });

    afterEach(() => {
      __setLambdaClientForTest(null);
      lambdaSendSpy.mockRestore();
      delete process.env.MEMORY_RETAIN_FN_NAME;
    });

    it("AE1: fires retainFullThread once per turn after assistant response", async () => {
      await runPiAgent(
        {
          message: "remember cobalt",
          model: "anthropic.test-model",
          use_memory: true,
          tenant_id: "tenant-A",
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

      // Wait a tick for the fire-and-forget promise to resolve.
      await new Promise((r) => setImmediate(r));

      expect(lambdaSendSpy).toHaveBeenCalledTimes(1);
      const cmd = lambdaSendSpy.mock.calls[0]?.[0] as {
        input: Record<string, unknown>;
      };
      expect(cmd.input.FunctionName).toBe("memory-retain-dev");
      expect(cmd.input.InvocationType).toBe("Event");
    });

    it("opt-out: use_memory=false does not fire retain", async () => {
      await runPiAgent(
        {
          message: "no retain please",
          model: "anthropic.test-model",
          use_memory: false,
          tenant_id: "tenant-A",
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
      await new Promise((r) => setImmediate(r));
      expect(lambdaSendSpy).not.toHaveBeenCalled();
    });

    it("AE5: Lambda invoke failure does not surface to caller (fire-and-forget)", async () => {
      lambdaSendSpy.mockRejectedValueOnce(new Error("network down"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await runPiAgent(
        {
          message: "remember cobalt",
          model: "anthropic.test-model",
          use_memory: true,
          tenant_id: "tenant-A",
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
      // Caller still gets a clean result; the failure logged but did not throw.
      expect(result.runtime).toBe("flue");
      await new Promise((r) => setImmediate(r));
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
