import { describe, expect, it } from "vitest";
import {
  buildDefaultAgentTurnWakeup,
  dispatchDefaultAgentChatTurn,
  dispatchDefaultAgentTurn,
  type DefaultAgentRoutingRepository,
} from "./default-agent-routing.js";

describe("default agent routing", () => {
  it("builds chat_message wakeups for the subscribed/default agent", () => {
    expect(
      buildDefaultAgentTurnWakeup({
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        messageId: "message-1",
        agentId: "agent-1",
        content: "Can you help?",
        sender: { type: "user", id: "user-1" },
      }),
    ).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      source: "chat_message",
      triggerDetail: "thread:thread-1:message:message-1",
      payload: {
        threadId: "thread-1",
        spaceId: "space-1",
        messageId: "message-1",
        userMessage: "Can you help?",
      },
      idempotencyKey: "agent-default:tenant-1:message-1:agent-1",
      requestedByActorType: "user",
      requestedByActorId: "user-1",
    });
  });

  it("does not enqueue when no subscribed/default agent exists", async () => {
    const repository = makeRepository(null);
    await expect(
      dispatchDefaultAgentTurn(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          messageId: "message-1",
        },
        repository,
      ),
    ).resolves.toBeNull();
    expect(repository.wakeups).toEqual([]);
  });

  it("directly invokes immediate chat turns without waiting for the wakeup scheduler", async () => {
    const repository = makeRepository({ agentId: "agent-1" });
    const invoked: unknown[] = [];

    await expect(
      dispatchDefaultAgentChatTurn(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          spaceId: "space-1",
          messageId: "message-1",
          content: "Please answer now",
          sender: { type: "user", id: "user-1" },
        },
        repository,
        {
          async invokeChatAgent(input) {
            invoked.push(input);
            return true;
          },
        },
        async () => [],
        async () => [],
      ),
    ).resolves.toEqual({
      agentId: "agent-1",
      directInvoked: true,
      enqueued: false,
      wakeupRequestId: null,
    });

    expect(invoked).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        userMessage: "Please answer now",
      },
    ]);
    expect(repository.wakeups).toEqual([]);
    expect(repository.assignments).toEqual([
      { tenantId: "tenant-1", threadId: "thread-1", agentId: "agent-1" },
    ]);
  });

  it("forwards resolved message attachments to the direct chat invoke", async () => {
    const repository = makeRepository({ agentId: "agent-1" });
    const invoked: unknown[] = [];
    const attachment = {
      attachmentId: "att-1",
      s3Key: "tenants/t/attachments/a/x/Budget.xlsx",
      name: "Budget.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 7704,
    };

    await dispatchDefaultAgentChatTurn(
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
        content: "What can you tell me about the Budget attached?",
        sender: { type: "user", id: "user-1" },
      },
      repository,
      {
        async invokeChatAgent(input) {
          invoked.push(input);
          return true;
        },
      },
      async () => [attachment],
      async () => [],
    );

    expect(invoked).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        userMessage: "What can you tell me about the Budget attached?",
        messageAttachments: [attachment],
      },
    ]);
  });

  it("forwards resolved pinned skills to the direct chat invoke", async () => {
    const repository = makeRepository({ agentId: "agent-1" });
    const invoked: unknown[] = [];

    await dispatchDefaultAgentChatTurn(
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
        content: "/crm-dashboard pull up the account",
        sender: { type: "user", id: "user-1" },
      },
      repository,
      {
        async invokeChatAgent(input) {
          invoked.push(input);
          return true;
        },
      },
      async () => [],
      async () => ["crm-dashboard", "invoice-parser"],
    );

    expect(invoked).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        userMessage: "/crm-dashboard pull up the account",
        pinnedSkills: ["crm-dashboard", "invoice-parser"],
      },
    ]);
  });

  it("forwards the selected parent model to direct chat invoke", async () => {
    const repository = makeRepository({ agentId: "agent-1" });
    const invoked: unknown[] = [];

    await dispatchDefaultAgentChatTurn(
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
        content: "Use the approved model",
        requestedModelId: "anthropic.claude-haiku",
        sender: { type: "user", id: "user-1" },
      },
      repository,
      {
        async invokeChatAgent(input) {
          invoked.push(input);
          return true;
        },
      },
      async () => [],
      async () => [],
    );

    expect(invoked).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        userMessage: "Use the approved model",
        requestedModelId: "anthropic.claude-haiku",
      },
    ]);
  });

  it("falls back to the wakeup queue when direct chat invoke is unavailable", async () => {
    const repository = makeRepository({ agentId: "agent-1" });

    await expect(
      dispatchDefaultAgentChatTurn(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          messageId: "message-1",
          content: "Fallback please",
          requestedModelId: "anthropic.claude-haiku",
        },
        repository,
        {
          async invokeChatAgent() {
            return false;
          },
        },
        async () => [],
        async () => [],
      ),
    ).resolves.toEqual({
      agentId: "agent-1",
      directInvoked: false,
      enqueued: true,
      wakeupRequestId: "wakeup-created",
    });

    expect(repository.wakeups[0]).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      payload: {
        threadId: "thread-1",
        messageId: "message-1",
        userMessage: "Fallback please",
        modelId: "anthropic.claude-haiku",
        requestedModelId: "anthropic.claude-haiku",
      },
    });
  });

  it("does not duplicate existing default agent wakeups", async () => {
    const repository = makeRepository({ agentId: "agent-1" }, "wakeup-1");
    await expect(
      dispatchDefaultAgentTurn(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          messageId: "message-1",
        },
        repository,
      ),
    ).resolves.toEqual({
      agentId: "agent-1",
      enqueued: false,
      wakeupRequestId: "wakeup-1",
    });
    expect(repository.wakeups).toEqual([]);
    expect(repository.assignments).toEqual([
      { tenantId: "tenant-1", threadId: "thread-1", agentId: "agent-1" },
    ]);
  });

  it("assigns the resolved default agent to the thread before enqueueing", async () => {
    const repository = makeRepository({ agentId: "platform-agent-1" });
    await expect(
      dispatchDefaultAgentTurn(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          spaceId: "space-1",
          messageId: "message-1",
          content: "Use the configured runtime",
        },
        repository,
      ),
    ).resolves.toEqual({
      agentId: "platform-agent-1",
      enqueued: true,
      wakeupRequestId: "wakeup-created",
    });
    expect(repository.assignments).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "platform-agent-1",
      },
    ]);
    expect(repository.wakeups[0].agentId).toBe("platform-agent-1");
  });
});

function makeRepository(
  defaultAgent: { agentId: string } | null,
  existingWakeupId?: string,
) {
  const repository = {
    wakeups: [] as Parameters<
      DefaultAgentRoutingRepository["createWakeup"]
    >[0][],
    assignments: [] as Parameters<
      DefaultAgentRoutingRepository["assignThreadDefaultAgent"]
    >[0][],
    async loadDefaultAgent() {
      return defaultAgent;
    },
    async assignThreadDefaultAgent(input) {
      repository.assignments.push(input);
    },
    async findExistingWakeup() {
      return existingWakeupId ? { id: existingWakeupId } : null;
    },
    async createWakeup(input) {
      repository.wakeups.push(input);
      return { id: "wakeup-created" };
    },
  } satisfies DefaultAgentRoutingRepository & {
    wakeups: Parameters<DefaultAgentRoutingRepository["createWakeup"]>[0][];
    assignments: Parameters<
      DefaultAgentRoutingRepository["assignThreadDefaultAgent"]
    >[0][];
  };
  return repository;
}
