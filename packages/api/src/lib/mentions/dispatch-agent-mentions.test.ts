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
        requestedModelId: "anthropic.claude-haiku",
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
          modelId: "anthropic.claude-haiku",
          requestedModelId: "anthropic.claude-haiku",
        },
        idempotencyKey:
          "agent-mention:tenant-1:message-1:11111111-1111-4111-8111-111111111111",
        requestedByActorType: "user",
        requestedByActorId: "user-1",
      },
    ]);
  });

  it("attaches reply-consumed answer context to the PRIMARY mention wakeup only", () => {
    const pendingQuestionAnswers = {
      questionId: "question-1",
      questions: [{ question: "Which env?", header: "Env", options: [] }],
      answers: null,
      answeredVia: "reply" as const,
      answeredBy: "user-1",
      replyMessageId: "message-1",
      replyText: "@Coordinator use Dev",
      delegationContext: null,
    };
    const wakeups = buildAgentMentionWakeups({
      tenantId: "tenant-1",
      threadId: "thread-1",
      messageId: "message-1",
      content: "@Coordinator use Dev",
      mentions: [
        mentions[0],
        {
          targetType: "agent" as const,
          targetId: "33333333-3333-4333-8333-333333333333",
          displayName: "Reviewer",
          rawText: "@Reviewer",
          startOffset: 21,
          endOffset: 30,
        },
      ],
      pendingQuestionAnswers,
      sender: { type: "user", id: "user-1" },
    });

    expect(wakeups).toHaveLength(2);
    // The nested payload key is the one the wakeup-processor parses for
    // chat_message wakeups (pendingQuestionAnswersFromPayload).
    expect(wakeups[0].payload.pendingQuestionAnswers).toEqual(
      pendingQuestionAnswers,
    );
    // Exactly one turn carries the answer context.
    expect(wakeups[1].payload).not.toHaveProperty("pendingQuestionAnswers");
  });

  it("omits the answer-context key when no question was consumed", () => {
    const [wakeup] = buildAgentMentionWakeups({
      tenantId: "tenant-1",
      threadId: "thread-1",
      messageId: "message-1",
      mentions,
    });
    expect(wakeup.payload).not.toHaveProperty("pendingQuestionAnswers");
  });

  it("appends an attempt suffix to each mention key for retries (KTD4)", () => {
    const [wakeup] = buildAgentMentionWakeups({
      tenantId: "tenant-1",
      threadId: "thread-1",
      messageId: "message-1",
      content: "@Coordinator retry",
      mentions,
      sender: { type: "user", id: "user-1" },
      attempt: 4,
    });
    expect(wakeup.idempotencyKey).toBe(
      "agent-mention:tenant-1:message-1:11111111-1111-4111-8111-111111111111:attempt-4",
    );
  });

  it("records per-agent failures without aborting the remaining dispatches (R7)", async () => {
    // Multi-agent mention where the first createWakeup throws: the loop must
    // still attempt the rest and report the failure per-agent.
    let calls = 0;
    const repository = {
      async findExistingWakeup() {
        return null;
      },
      async createWakeup() {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { id: "wakeup-ok" };
      },
    } satisfies AgentMentionDispatchRepository;

    const twoAgents = [
      mentions[0],
      {
        targetType: "agent" as const,
        targetId: "44444444-4444-4444-8444-444444444444",
        displayName: "Reviewer",
        rawText: "@Reviewer",
        startOffset: 20,
        endOffset: 29,
      },
    ];

    const results = await dispatchAgentMentions(
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        messageId: "message-1",
        content: "@Coordinator @Reviewer",
        mentions: twoAgents,
        sender: { type: "user", id: "user-1" },
      },
      repository,
    );

    expect(results).toEqual([
      {
        agentId: "11111111-1111-4111-8111-111111111111",
        enqueued: false,
        failed: true,
        error: "boom",
      },
      {
        agentId: "44444444-4444-4444-8444-444444444444",
        enqueued: true,
        wakeupRequestId: "wakeup-ok",
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
