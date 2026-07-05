import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/react-native-sdk", async () => {
  return await import("../../../../packages/react-native-sdk/src/send-message-options");
});

import { buildThreadConversationSendVariables } from "../thread-conversation-send";

describe("thread conversation send variables", () => {
  it("preserves the in-thread user send payload shape with matching mentions", () => {
    expect(
      buildThreadConversationSendVariables({
        threadId: "thread-1",
        content: "Hey @Scott Hertel, please review.",
        currentUserId: "user-me",
        mentions: [
          {
            id: "target-1",
            targetType: "USER",
            targetId: "user-scott",
            displayName: "Scott Hertel",
            rawText: "@Scott Hertel",
            type: "member",
          },
          {
            id: "target-2",
            targetType: "AGENT",
            targetId: "agent-1",
            displayName: "Agent One",
            rawText: "@Agent One",
            type: "assistant",
          },
        ],
      }),
    ).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "Hey @Scott Hertel, please review.",
        senderType: "user",
        senderId: "user-me",
        mentions: [
          {
            targetType: "USER",
            targetId: "user-scott",
            displayName: "Scott Hertel",
            rawText: "@Scott Hertel",
          },
        ],
      },
    });
  });

  it("omits senderId and mentions when there is no current user or matching mention text", () => {
    expect(
      buildThreadConversationSendVariables({
        threadId: "thread-1",
        content: "No mentions here.",
        mentions: [
          {
            id: "target-1",
            targetType: "USER",
            targetId: "user-scott",
            displayName: "Scott Hertel",
            rawText: "@Scott Hertel",
            type: "member",
          },
        ],
      }),
    ).toEqual({
      input: {
        threadId: "thread-1",
        role: "USER",
        content: "No mentions here.",
        senderType: "user",
      },
    });
  });
});
