import { describe, expect, it } from "vitest";
import {
  buildDefaultAgentTurnWakeup,
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
    async loadDefaultAgent() {
      return defaultAgent;
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
  };
  return repository;
}
