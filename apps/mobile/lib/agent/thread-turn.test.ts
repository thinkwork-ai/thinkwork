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
import type { MobileTurnLeaseClient } from "./turn-lease";
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

function fakeLeaseClient(
  overrides: Partial<MobileTurnLeaseClient> = {},
): MobileTurnLeaseClient {
  let checkpointSeq = 0;
  return {
    start: vi.fn().mockResolvedValue({
      threadTurnId: "turn-1",
      threadId: "thr_1",
      userMessageId: "um",
      status: "running",
      checkpointSeq: 0,
      idempotent: false,
    }),
    heartbeat: vi.fn().mockResolvedValue({ ok: true }),
    checkpoint: vi.fn().mockImplementation(async () => ({
      seq: ++checkpointSeq,
    })),
    background: vi.fn().mockResolvedValue({ ok: true }),
    abort: vi.fn().mockResolvedValue({ ok: true }),
    finalize: vi
      .fn()
      .mockResolvedValue({ finalized: true, assistantMessageId: "am" }),
    ...overrides,
  };
}

describe("runThreadHarnessTurn", () => {
  it("starts a durable lease before calling the model and finalizes the same turn", async () => {
    const order: string[] = [];
    const lease = fakeLeaseClient({
      start: vi.fn().mockImplementation(async () => {
        order.push("start");
        return {
          threadTurnId: "turn-1",
          threadId: "thr_1",
          userMessageId: "um",
          status: "running",
          checkpointSeq: 0,
          idempotent: false,
        };
      }),
    });
    const provider = new MockModelProvider(() => {
      order.push("model");
      return textResponse("on it");
    });

    const res = await runThreadHarnessTurn(
      {
        threadId: "thr_1",
        userText: "hello",
        priorMessages: [],
        agentId: "agent-1",
        userId: "user-1",
        userName: "Eric Odom",
        userEmail: "eric@example.com",
        tenantId: "tenant-1",
        spaceId: "space-1",
        clientTurnId: "client-1",
      },
      { modelProvider: provider, turnLeaseClient: lease },
    );

    expect(res).toEqual({ assistantText: "on it", ok: true });
    expect(order).toEqual(["start", "model"]);
    expect(lease.start).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: "client-1",
        threadId: "thr_1",
        agentId: "agent-1",
        userText: "hello",
        metadata: expect.objectContaining({
          user_id: "user-1",
          user_name: "Eric Odom",
          user_email: "eric@example.com",
          tenant_id: "tenant-1",
          space_id: "space-1",
        }),
      }),
    );
    expect(lease.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTurnId: "turn-1",
        assistantText: "on it",
        diagnostics: { clientTurnId: "client-1" },
      }),
    );
  });

  it("heartbeats while the provider is pending and stops after completion", async () => {
    vi.useFakeTimers();
    try {
      let resolveModel!: () => void;
      const modelDone = new Promise<void>((resolve) => {
        resolveModel = resolve;
      });
      const provider = {
        id: "pending",
        generate: vi.fn(async () => {
          await modelDone;
          return textResponse("done");
        }),
      };
      const lease = fakeLeaseClient();

      const run = runThreadHarnessTurn(
        { threadId: "thr_1", userText: "hello", priorMessages: [] },
        {
          modelProvider: provider,
          turnLeaseClient: lease,
          heartbeatIntervalMs: 1000,
        },
      );
      await vi.waitFor(() => expect(provider.generate).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(2500);
      expect(lease.heartbeat).toHaveBeenCalledTimes(2);

      resolveModel();
      await run;
      await vi.advanceTimersByTimeAsync(2500);
      expect(lease.heartbeat).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checkpoints safe transcript evidence and unsafe in-flight tool calls", async () => {
    const lease = fakeLeaseClient();
    const provider = new MockModelProvider([
      toolResponse("c1", "create_crm_opportunity", {}, "creating"),
      textResponse("created opp_1"),
    ]);

    await runThreadHarnessTurn(
      {
        threadId: "thr_1",
        userText: "add acme",
        priorMessages: [],
        tools: [crmTool()],
      },
      { modelProvider: provider, turnLeaseClient: lease },
    );

    const checkpointCalls = vi
      .mocked(lease.checkpoint)
      .mock.calls.map(([input]) => input);
    expect(checkpointCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          safe: false,
          checkpoint: expect.objectContaining({
            event_type: "tool_call",
            event_log: expect.arrayContaining([
              expect.objectContaining({ type: "tool_call" }),
            ]),
            unsafe_reason: "tool_call_in_flight",
          }),
        }),
        expect.objectContaining({
          safe: false,
          checkpoint: expect.objectContaining({
            event_type: "tool_result",
            name: "create_crm_opportunity",
          }),
        }),
        expect.objectContaining({
          safe: true,
          checkpoint: expect.objectContaining({
            event_type: "assistant_text",
            text: "created opp_1",
          }),
        }),
      ]),
    );
  });

  it("sends background signals without aborting the local run", async () => {
    let backgroundHandler: ((reason: string) => void) | null = null;
    let resolveModel!: () => void;
    const modelDone = new Promise<void>((resolve) => {
      resolveModel = resolve;
    });
    const provider = {
      id: "pending",
      generate: vi.fn(async () => {
        await modelDone;
        return textResponse("done");
      }),
    };
    const lease = fakeLeaseClient();

    const run = runThreadHarnessTurn(
      { threadId: "thr_1", userText: "hello", priorMessages: [] },
      {
        modelProvider: provider,
        turnLeaseClient: lease,
        subscribeToBackground: (handler) => {
          backgroundHandler = handler;
          return vi.fn();
        },
      },
    );
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalled());

    backgroundHandler?.("background");
    await vi.waitFor(() =>
      expect(lease.background).toHaveBeenCalledWith({
        threadTurnId: "turn-1",
        reason: "background",
      }),
    );

    resolveModel();
    const res = await run;
    expect(res.ok).toBe(true);
    expect(lease.abort).not.toHaveBeenCalled();
  });

  it("does not call the model when lifecycle start fails", async () => {
    const provider = new MockModelProvider([textResponse("should not run")]);
    const lease = fakeLeaseClient({
      start: vi.fn().mockRejectedValue(new Error("start failed")),
    });

    await expect(
      runThreadHarnessTurn(
        { threadId: "thr_1", userText: "hello", priorMessages: [] },
        { modelProvider: provider, turnLeaseClient: lease },
      ),
    ).rejects.toThrow(/start failed/);
    expect(provider.requests).toHaveLength(0);
  });

  it("returns ok=false when local finalize loses the managed-claim race", async () => {
    const provider = new MockModelProvider([textResponse("late local answer")]);
    const lease = fakeLeaseClient({
      finalize: vi
        .fn()
        .mockRejectedValue(
          new Error("mobile-turn-session finalize 409: FINALIZE_REJECTED"),
        ),
    });

    const res = await runThreadHarnessTurn(
      { threadId: "thr_1", userText: "hello", priorMessages: [] },
      { modelProvider: provider, turnLeaseClient: lease },
    );

    expect(res).toEqual({ assistantText: "late local answer", ok: false });
  });

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
    expect(provider.requests[0].tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "mobile_photo",
        "mobile_file",
        "mobile_clipboard",
      ]),
    );
    expect(provider.requests[0].system).toContain("local `bash` tool");
  });

  it("advertises direct web_search plus MCP gateway when an agent is selected", async () => {
    const provider = new MockModelProvider([textResponse("ready")]);
    const recordTurnFn = vi.fn().mockResolvedValue({});

    await runThreadHarnessTurn(
      {
        threadId: "t-tools",
        userText: "what tools do you have?",
        priorMessages: [],
        agentId: "agent-1",
      },
      { modelProvider: provider, recordTurnFn },
    );

    expect(provider.requests[0].tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["bash", "web_search", "mcp"]),
    );
    expect(provider.requests[0].system).toContain("direct `web_search` tool");
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
    expect(recordTurnFn.mock.calls[0][0].toolResults[0].attachments).toEqual([
      expect.objectContaining({
        type: "mobile_native_capability",
        source: "photo_library",
        mimeType: "image/jpeg",
      }),
    ]);
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
