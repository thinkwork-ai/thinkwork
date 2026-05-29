import { describe, expect, it } from "vitest";
import { createAgentSession, defineTool } from "./session";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
import type { AgentEvent, Tool } from "./types";

function echoTool(): Tool {
  return defineTool({
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: { v: { type: "string" } } },
    execute: async (a) => ({ content: `echo:${String(a.v)}` }),
  });
}

describe("defineTool", () => {
  it("returns the tool object unchanged (flat, Pi-style)", () => {
    const t = echoTool();
    expect(t.name).toBe("echo");
    expect(typeof t.execute).toBe("function");
  });
});

describe("createAgentSession", () => {
  it("prompt() runs a turn and accumulates messages on the session", async () => {
    const session = createAgentSession({
      modelProvider: new MockModelProvider([textResponse("hello")]),
      systemPrompt: "be brief",
    });

    const result = await session.prompt("hi");

    expect(result.finalText).toBe("hello");
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(session.messages[0].content).toBe("hi");
    expect(session.messages[1].content).toBe("hello");
  });

  it("carries the transcript across multiple prompts", async () => {
    const session = createAgentSession({
      modelProvider: new MockModelProvider([
        textResponse("first answer"),
        textResponse("second answer"),
      ]),
    });

    await session.prompt("one");
    await session.prompt("two");

    expect(session.messages.map((m) => m.content)).toEqual([
      "one",
      "first answer",
      "two",
      "second answer",
    ]);
  });

  it("runs tools and emits lifecycle events to subscribers", async () => {
    const session = createAgentSession({
      modelProvider: new MockModelProvider([
        toolResponse("c1", "echo", { v: "ping" }, "checking"),
        textResponse("done"),
      ]),
      tools: [echoTool()],
    });
    const events: AgentEvent[] = [];
    const unsub = session.subscribe((e) => events.push(e));

    const result = await session.prompt("go");

    expect(result.finalText).toBe("done");
    expect(events.map((e) => e.type)).toEqual([
      "assistant_text",
      "tool_call",
      "tool_result",
      "assistant_text",
      "done",
    ]);
    unsub();
  });

  it("seeds from prior messages and forwards images", async () => {
    const provider = new MockModelProvider([textResponse("a card")]);
    const session = createAgentSession({
      modelProvider: provider,
      messages: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "ok" },
      ],
    });

    await session.prompt("what's this?", [{ format: "jpeg", data: "QUJD" }]);

    const sent = provider.requests[0].messages;
    expect(sent.map((m) => m.content)).toEqual([
      "earlier",
      "ok",
      "what's this?",
    ]);
    expect(sent.at(-1)?.images).toEqual([{ format: "jpeg", data: "QUJD" }]);
  });

  it("stops the listener after unsubscribe", async () => {
    const session = createAgentSession({
      modelProvider: new MockModelProvider([
        textResponse("a"),
        textResponse("b"),
      ]),
    });
    const events: AgentEvent[] = [];
    const unsub = session.subscribe((e) => events.push(e));
    await session.prompt("one");
    const countAfterFirst = events.length;
    unsub();
    await session.prompt("two");
    expect(events.length).toBe(countAfterFirst);
  });
});
