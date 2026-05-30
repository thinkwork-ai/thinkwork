import { describe, expect, it, vi } from "vitest";
import { runThreadHarnessTurn } from "./thread-turn";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
import { defineTool } from "./session";
import type { Tool } from "./types";

function crmTool(): Tool {
  return defineTool({
    name: "create_crm_opportunity",
    description: "create a CRM opp",
    parameters: { type: "object" },
    execute: async () => ({ content: '{"id":"opp_1"}' }),
  });
}

describe("runThreadHarnessTurn", () => {
  it("runs a turn and persists the user+assistant pair to the thread", async () => {
    const provider = new MockModelProvider([textResponse("on it")]);
    const recordTurnFn = vi.fn().mockResolvedValue({
      threadId: "thr_1",
      userMessageId: "um",
      assistantMessageId: "am",
    });

    const res = await runThreadHarnessTurn(
      { threadId: "thr_1", userText: "hello", priorMessages: [] },
      { modelProvider: provider, recordTurnFn },
    );

    expect(res).toEqual({ assistantText: "on it", ok: true });
    expect(recordTurnFn).toHaveBeenCalledWith({
      threadId: "thr_1",
      userText: "hello",
      assistantText: "on it",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("feeds prior thread messages (user/assistant only) as context", async () => {
    const provider = new MockModelProvider([textResponse("ok")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    await runThreadHarnessTurn(
      {
        threadId: "t",
        userText: "follow up",
        priorMessages: [
          { role: "USER", content: "earlier q" },
          { role: "ASSISTANT", content: "earlier a" },
          { role: "system", content: "audit row — dropped" },
        ],
      },
      { modelProvider: provider, recordTurnFn },
    );

    const sent = provider.requests[0].messages;
    expect(sent.map((m) => m.content)).toEqual([
      "earlier q",
      "earlier a",
      "follow up",
    ]);
  });

  it("coalesces consecutive same-role prior messages (Bedrock needs alternating roles)", async () => {
    const provider = new MockModelProvider([textResponse("ok")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    await runThreadHarnessTurn(
      {
        threadId: "t",
        userText: "now",
        priorMessages: [
          { role: "USER", content: "first" },
          { role: "USER", content: "second" },
          { role: "ASSISTANT", content: "reply" },
        ],
      },
      { modelProvider: provider, recordTurnFn },
    );

    const sent = provider.requests[0].messages;
    expect(sent.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "first\n\nsecond" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "now" },
    ]);
  });

  it("runs tools mid-turn and still persists the final answer", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "create_crm_opportunity", {}, "creating"),
      textResponse("created opp_1"),
    ]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    const res = await runThreadHarnessTurn(
      {
        threadId: "t",
        userText: "add acme",
        priorMessages: [],
        tools: [crmTool()],
      },
      { modelProvider: provider, recordTurnFn },
    );

    expect(res.assistantText).toBe("created opp_1");
    expect(recordTurnFn.mock.calls[0][0].assistantText).toBe("created opp_1");
  });

  it("reports ok=false when the turn errors", async () => {
    const provider = new MockModelProvider(() => {
      throw new Error("model down");
    });
    const recordTurnFn = vi.fn().mockResolvedValue({});

    const res = await runThreadHarnessTurn(
      { threadId: "t", userText: "hi", priorMessages: [] },
      { modelProvider: provider, recordTurnFn },
    );

    expect(res.ok).toBe(false);
    // still records the (empty/errored) turn so the user message isn't lost
    expect(recordTurnFn).toHaveBeenCalled();
  });
});
