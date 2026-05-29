import { describe, expect, it, vi } from "vitest";
import { runHarnessChatTurn } from "./harness-chat-core";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
import { ToolRegistry } from "./tool-registry";
import type { Tool } from "./types";
import type { ChatMessage } from "../../hooks/useGatewayChat";

let t = 1000;
const now = () => (t += 1);

function echoTool(): Tool {
  return {
    spec: { name: "echo", description: "echo", parameters: { type: "object" } },
    execute: async (a) => ({ content: `echo:${String(a.v)}` }),
  };
}

describe("runHarnessChatTurn", () => {
  it("appends a user message and a completed assistant message", async () => {
    const provider = new MockModelProvider([textResponse("hi there")]);
    const updates: ChatMessage[][] = [];

    const final = await runHarnessChatTurn({
      userText: "hello",
      prior: [],
      provider,
      now,
      onUpdate: (m) => updates.push(m),
    });

    expect(final.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(final[0].content).toBe("hello");
    expect(final[1].content).toBe("hi there");
    expect(final[1].isStreaming).toBe(false);
    // an optimistic streaming snapshot was emitted before the final one
    expect(updates[0][1].isStreaming).toBe(true);
  });

  it("preserves prior transcript and feeds it to the model", async () => {
    const provider = new MockModelProvider([textResponse("ok")]);
    const prior: ChatMessage[] = [
      { id: "1", role: "user", content: "earlier q", timestamp: 1 },
      { id: "2", role: "assistant", content: "earlier a", timestamp: 2 },
    ];

    const final = await runHarnessChatTurn({
      userText: "follow up",
      prior,
      provider,
      now,
      onUpdate: () => {},
    });

    expect(final).toHaveLength(4); // 2 prior + user + assistant
    const sent = provider.requests[0].messages;
    expect(sent.map((m) => m.content)).toEqual([
      "earlier q",
      "earlier a",
      "follow up",
    ]);
  });

  it("streams assistant text through onUpdate before finalizing", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "echo", { v: "x" }, "working on it"),
      textResponse("done"),
    ]);
    const registry = new ToolRegistry([echoTool()]);
    void registry;
    const contents: string[] = [];

    await runHarnessChatTurn({
      userText: "go",
      prior: [],
      provider,
      tools: [echoTool()],
      now,
      onUpdate: (m) => {
        const a = m.find((x) => x.role === "assistant");
        if (a) contents.push(a.content);
      },
    });

    expect(contents).toContain("working on it");
    expect(contents[contents.length - 1]).toBe("done");
  });

  it("renders an error message when the turn fails", async () => {
    const provider = new MockModelProvider(() => {
      throw new Error("model down");
    });

    const final = await runHarnessChatTurn({
      userText: "hi",
      prior: [],
      provider,
      now,
      onUpdate: () => {},
    });

    const assistant = final[final.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.content).toMatch(/went wrong/i);
  });

  it("forwards images on the user turn to the model", async () => {
    const provider = new MockModelProvider([textResponse("a business card")]);

    await runHarnessChatTurn({
      userText: "what's this?",
      images: [{ format: "jpeg", data: "QUJD" }],
      prior: [],
      provider,
      now,
      onUpdate: () => {},
    });

    const userTurn = provider.requests[0].messages.at(-1);
    expect(userTurn?.images).toEqual([{ format: "jpeg", data: "QUJD" }]);
  });
});
