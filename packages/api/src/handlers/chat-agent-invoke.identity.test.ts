import { describe, expect, it, vi } from "vitest";
import {
  resolveChatInvokeIdentity,
  type ChatInvokeIdentityDeps,
} from "./chat-agent-invoke.js";

function deps(
  overrides: Partial<ChatInvokeIdentityDeps> = {},
): ChatInvokeIdentityDeps {
  return {
    loadMessageSender: vi.fn(async () => null),
    loadThreadCreator: vi.fn(async () => null),
    loadAgentHumanPair: vi.fn(async () => null),
    loadUserEmail: vi.fn(async (userId) => `${userId}@example.com`),
    ...overrides,
  };
}

const baseArgs = {
  threadId: "thread-1",
  tenantId: "tenant-1",
  agentId: "agent-1",
};

describe("resolveChatInvokeIdentity", () => {
  it("uses the human message sender when present", async () => {
    const subject = deps({
      loadMessageSender: vi.fn(async () => ({
        sender_id: "user-message",
        sender_type: "human",
      })),
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "user-thread",
        created_by_type: "user",
      })),
    });

    const identity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-1" },
      subject,
    );

    expect(identity).toEqual({
      currentUserId: "user-message",
      currentUserEmail: "user-message@example.com",
      source: "message_sender",
    });
    expect(subject.loadThreadCreator).not.toHaveBeenCalled();
  });

  it("falls back to the user-created thread when the message is not human-authored", async () => {
    const subject = deps({
      loadMessageSender: vi.fn(async () => ({
        sender_id: "connector-1",
        sender_type: "connector",
      })),
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "user-thread",
        created_by_type: "user",
      })),
    });

    const identity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-1" },
      subject,
    );

    expect(identity).toEqual({
      currentUserId: "user-thread",
      currentUserEmail: "user-thread@example.com",
      source: "thread_creator",
    });
  });

  it("uses the target agent's paired human for connector-created threads", async () => {
    const subject = deps({
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "connector-1",
        created_by_type: "connector",
      })),
      loadAgentHumanPair: vi.fn(async () => "paired-human"),
    });

    const identity = await resolveChatInvokeIdentity(baseArgs, subject);

    expect(identity).toEqual({
      currentUserId: "paired-human",
      currentUserEmail: "paired-human@example.com",
      source: "connector_agent_human_pair",
    });
    expect(subject.loadAgentHumanPair).toHaveBeenCalledWith({
      agentId: "agent-1",
      tenantId: "tenant-1",
    });
  });

  it("returns no identity when a connector-created thread has no paired human", async () => {
    const subject = deps({
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "connector-1",
        created_by_type: "connector",
      })),
      loadAgentHumanPair: vi.fn(async () => null),
    });

    await expect(resolveChatInvokeIdentity(baseArgs, subject)).resolves.toEqual(
      {
        currentUserId: "",
        currentUserEmail: "",
        source: "none",
      },
    );
  });

  it("does not use the agent human pair for generic non-connector threads", async () => {
    const subject = deps({
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: null,
        created_by_type: "system",
      })),
      loadAgentHumanPair: vi.fn(async () => "paired-human"),
    });

    const identity = await resolveChatInvokeIdentity(baseArgs, subject);

    expect(identity).toEqual({
      currentUserId: "",
      currentUserEmail: "",
      source: "none",
    });
    expect(subject.loadAgentHumanPair).not.toHaveBeenCalled();
  });
});
