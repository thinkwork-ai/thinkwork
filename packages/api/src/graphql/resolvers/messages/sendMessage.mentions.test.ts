import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./sendMessage.mutation.ts", import.meta.url),
  "utf8",
);

describe("sendMessage mention collaboration path", () => {
  it("validates and persists structured mentions before dispatching agent wakeups", () => {
    expect(source).toContain("loadThreadMentionTargets");
    expect(source).toContain("validateExplicitMentions");
    expect(source).toContain("parseMessageMentions");
    expect(source).toContain("insert(messageMentions)");
    expect(source).toContain("dispatchAgentMentions");
  });

  it("publishes user messages to collaborative thread subscribers", () => {
    expect(source).toContain("notifyNewMessage");
    expect(source).toContain("messageId: row.id");
    expect(source).toContain("senderType");
    expect(source).toContain("senderId");
  });

  it("refreshes activity for non-Computer Space collaboration user messages", () => {
    expect(source).toContain("!isUserMessage || !thread.computer_id");
    expect(source).toContain(
      "collaboration without a Computer needs human messages",
    );
    expect(source).toContain("notifyThreadUpdate");
  });
});
