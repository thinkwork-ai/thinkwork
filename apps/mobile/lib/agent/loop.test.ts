import { describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./loop";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
import { defineTool } from "./session";
import type { AgentEvent, Message, Tool } from "./types";

function echoTool(): Tool {
  return defineTool({
    name: "echo",
    description: "Echo the input back",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    execute: async (args) => ({ content: `echo:${String(args.value)}` }),
  });
}

function user(content: string): Message {
  return { role: "user", content };
}

describe("runAgentTurn", () => {
  it("returns the model's direct answer when no tools are requested", async () => {
    const provider = new MockModelProvider([textResponse("Hello there")]);

    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [user("hi")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("Hello there");
    expect(result.steps).toBe(1);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("runs a tool then feeds the result back for a final answer (multi-step)", async () => {
    const provider = new MockModelProvider([
      toolResponse("call-1", "echo", { value: "ping" }, "let me check"),
      textResponse("the echo said ping"),
    ]);

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("echo ping")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("the echo said ping");
    expect(result.steps).toBe(2);
    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const toolMsg = result.messages[2];
    expect(toolMsg.toolCallId).toBe("call-1");
    expect(toolMsg.content).toBe("echo:ping");
    expect(toolMsg.isError).toBeUndefined();
  });

  it("passes the advertised tool specs and prior messages to the provider", async () => {
    const provider = new MockModelProvider([textResponse("ok")]);

    await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("hi")],
      system: "be brief",
    });

    expect(provider.requests[0].system).toBe("be brief");
    expect(provider.requests[0].tools.map((t) => t.name)).toEqual(["echo"]);
    expect(provider.requests[0].messages).toEqual([user("hi")]);
  });

  it("surfaces a tool failure as an error result the model can recover from", async () => {
    const failing: Tool = defineTool({
      name: "boom",
      description: "always throws",
      parameters: { type: "object" },
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const provider = new MockModelProvider([
      toolResponse("c1", "boom", {}),
      textResponse("recovered"),
    ]);

    const result = await runAgentTurn({
      provider,
      tools: [failing],
      messages: [user("go")],
    });

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toContain("kaboom");
    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("recovered");
  });

  it("returns an error result for an unknown tool", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "missing", {}),
      textResponse("ok"),
    ]);
    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [user("go")],
    });
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toContain("Unknown tool: missing");
  });

  it("stops with max_steps when the model keeps calling tools", async () => {
    const provider = new MockModelProvider(() =>
      toolResponse("loop", "echo", { value: "x" }),
    );

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("loop forever")],
      maxSteps: 3,
    });

    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toBe(3);
  });

  it("stops with aborted when the signal is already aborted", async () => {
    const provider = new MockModelProvider([textResponse("should not run")]);

    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [user("hi")],
      signal: AbortSignal.abort(),
    });

    expect(result.stopReason).toBe("aborted");
    expect(result.steps).toBe(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("returns stopReason error when the provider throws", async () => {
    const provider = new MockModelProvider(() => {
      throw new Error("network down");
    });
    const events: AgentEvent[] = [];

    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [user("hi")],
      onEvent: (e) => {
        events.push(e);
      },
    });

    expect(result.stopReason).toBe("error");
    expect(
      events.some(
        (e) => e.type === "error" && e.error.includes("network down"),
      ),
    ).toBe(true);
  });

  it("accumulates usage across steps and does not mutate the caller's messages", async () => {
    const seed = [user("hi")];
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: { value: "a" } }],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        text: "done",
        toolCalls: [],
        stopReason: "end",
        usage: { inputTokens: 8, outputTokens: 3 },
      },
    ]);

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: seed,
    });

    expect(result.usage).toEqual({ inputTokens: 18, outputTokens: 8 });
    expect(seed).toEqual([user("hi")]);
  });

  it("emits Pi-shaped lifecycle and tool events in order", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "echo", { value: "z" }, "checking"),
      textResponse("all set"),
    ]);
    const onEvent = vi.fn();

    await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("go")],
      onEvent,
    });

    const kinds = onEvent.mock.calls.map((c) => (c[0] as AgentEvent).type);
    expect(kinds).toEqual([
      "agent_start",
      "assistant_text",
      "tool_call",
      "tool_result",
      "after_tool_call",
      "assistant_text",
      "agent_end",
      "done",
    ]);
  });
});
