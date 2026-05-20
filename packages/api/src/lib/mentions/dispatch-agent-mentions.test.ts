import { describe, expect, it } from "vitest";
import {
  type AgentMentionDispatchRepository,
  buildAgentMentionWakeups,
  dispatchAgentMentions,
} from "./dispatch-agent-mentions.js";

const mentions = [
  {
    targetType: "agent" as const,
    targetId: "11111111-1111-4111-8111-111111111111",
    displayName: "Coordinator",
    rawText: "@Coordinator",
    startOffset: 0,
    endOffset: 12,
  },
  {
    targetType: "user" as const,
    targetId: "22222222-2222-4222-8222-222222222222",
    displayName: "Alex Finance",
    rawText: "@Alex Finance",
    startOffset: 18,
    endOffset: 31,
  },
];

describe("dispatchAgentMentions", () => {
  it("builds one idempotent wakeup per agent mention", () => {
    expect(
      buildAgentMentionWakeups({
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        messageId: "message-1",
        content: "@Coordinator can you help?",
        mentions,
        sender: { type: "user", id: "user-1" },
      }),
    ).toEqual([
      {
        tenantId: "tenant-1",
        agentId: "11111111-1111-4111-8111-111111111111",
        source: "chat_message",
        reason: "Coordinator mentioned in Thread",
        triggerDetail: "thread:thread-1:message:message-1",
        payload: {
          threadId: "thread-1",
          spaceId: "space-1",
          messageId: "message-1",
          userMessage: "@Coordinator can you help?",
          mention: {
            displayName: "Coordinator",
            rawText: "@Coordinator",
            startOffset: 0,
            endOffset: 12,
          },
          message: "@Coordinator can you help?",
        },
        idempotencyKey:
          "agent-mention:tenant-1:message-1:11111111-1111-4111-8111-111111111111",
        requestedByActorType: "user",
        requestedByActorId: "user-1",
      },
    ]);
  });

  it("does not enqueue when the mention wakeup already exists", async () => {
    const repository = makeRepository("existing-wakeup");

    await expect(
      dispatchAgentMentions(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          messageId: "message-1",
          mentions,
        },
        repository,
      ),
    ).resolves.toEqual([
      {
        agentId: "11111111-1111-4111-8111-111111111111",
        enqueued: false,
        wakeupRequestId: "existing-wakeup",
      },
    ]);
    expect(repository.wakeups).toEqual([]);
  });
});

function makeRepository(existingWakeupId?: string) {
  const repository = {
    wakeups: [] as Parameters<
      AgentMentionDispatchRepository["createWakeup"]
    >[0][],
    async findExistingWakeup() {
      return existingWakeupId ? { id: existingWakeupId } : null;
    },
    async createWakeup(input) {
      repository.wakeups.push(input);
      return { id: "wakeup-1" };
    },
  } satisfies AgentMentionDispatchRepository & {
    wakeups: Parameters<AgentMentionDispatchRepository["createWakeup"]>[0][];
  };
  return repository;
}
