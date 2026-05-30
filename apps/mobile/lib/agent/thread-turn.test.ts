import { describe, expect, it, vi } from "vitest";
import { runThreadHarnessTurn } from "./thread-turn";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
import { defineTool } from "./session";
import { defineExtension } from "./extensions/define-extension";
import {
  MemoryWorkspaceCacheStorage,
  WorkspaceCache,
  type WorkspaceCacheSource,
} from "./workspace-cache";
import type { Tool } from "./types";
import type { WorkspaceTarget } from "@/lib/workspace-api";

function crmTool(): Tool {
  return defineTool({
    name: "create_crm_opportunity",
    description: "create a CRM opp",
    parameters: { type: "object" },
    execute: async () => ({ content: '{"id":"opp_1"}' }),
  });
}

class FakeWorkspaceSource implements WorkspaceCacheSource {
  async listFiles(_target: WorkspaceTarget) {
    return {
      files: [
        {
          path: "USER.md",
          source: "user" as const,
          sha256: "user",
          overridden: false,
          content: "The human's name is Eric.",
        },
      ],
    };
  }
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
    expect(recordTurnFn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thr_1",
        userText: "hello",
        assistantText: "on it",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    );
    expect(recordTurnFn.mock.calls[0][0].toolResults[0]).toMatchObject({
      type: "mobile_session",
      stopReason: "completed",
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

  it("emits turn events for smoke tests and future activity rendering", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "create_crm_opportunity", {}, "creating"),
      textResponse("created opp_1"),
    ]);
    const recordTurnFn = vi.fn().mockResolvedValue({});
    const events: string[] = [];

    await runThreadHarnessTurn(
      {
        threadId: "t",
        userText: "add acme",
        priorMessages: [],
        tools: [crmTool()],
      },
      {
        modelProvider: provider,
        recordTurnFn,
        onEvent: (event) => events.push(event.type),
      },
    );

    expect(events).toEqual([
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

  it("runs a tool supplied by an extension and reflects it in the answer", async () => {
    const provider = new MockModelProvider([
      toolResponse("c1", "ext_tool", { q: "acme" }, "looking"),
      textResponse("found acme"),
    ]);
    const recordTurnFn = vi.fn().mockResolvedValue({});
    const ext = defineExtension({
      name: "test-ext",
      register: (pi) => {
        pi.registerTool({
          name: "ext_tool",
          description: "an extension-supplied tool",
          parameters: { type: "object" },
          execute: async () => ({ content: "acme inc" }),
        });
      },
    });

    const res = await runThreadHarnessTurn(
      { threadId: "t", userText: "find acme", priorMessages: [] },
      { modelProvider: provider, recordTurnFn, extensions: [ext] },
    );

    expect(res.assistantText).toBe("found acme");
    // The extension's tool was advertised to the model.
    expect(provider.requests[0].tools.map((t) => t.name)).toContain("ext_tool");
  });

  it("advertises the built-in local bash tool on default thread turns", async () => {
    const provider = new MockModelProvider([textResponse("ready")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    await runThreadHarnessTurn(
      {
        threadId: "t-bash",
        userText: "can you run shell commands?",
        priorMessages: [],
      },
      { modelProvider: provider, recordTurnFn },
    );

    expect(provider.requests[0].tools.map((t) => t.name)).toContain("bash");
    expect(provider.requests[0].system).toContain("local `bash` tool");
  });

  it("advertises cached workspace tools and USER.md context when user context is available", async () => {
    const provider = new MockModelProvider([textResponse("Eric")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});
    const workspaceCache = new WorkspaceCache(
      new MemoryWorkspaceCacheStorage(),
      new FakeWorkspaceSource(),
    );

    await runThreadHarnessTurn(
      {
        threadId: "t-workspace",
        userText: "what is my name?",
        priorMessages: [],
        userId: "user-1",
        tenantId: "tenant-1",
      },
      { modelProvider: provider, recordTurnFn, workspaceCache },
    );

    expect(provider.requests[0].tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["read", "grep", "find", "ls", "bash"]),
    );
    expect(provider.requests[0].system).toContain("The human's name is Eric.");
    expect(provider.requests[0].system).toContain("cached ThinkWork workspace");
  });

  it("forwards attached images to the model on the user turn", async () => {
    const provider = new MockModelProvider([textResponse("a business card")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    await runThreadHarnessTurn(
      {
        threadId: "t",
        userText: "make an opportunity from this card",
        priorMessages: [],
        images: [{ format: "jpeg", data: "QUJD" }],
      },
      { modelProvider: provider, recordTurnFn },
    );

    const sent = provider.requests[0].messages;
    expect(sent.at(-1)?.images).toEqual([{ format: "jpeg", data: "QUJD" }]);
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
