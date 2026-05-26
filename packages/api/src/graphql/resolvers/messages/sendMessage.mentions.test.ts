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
    expect(source).toContain("db.transaction");
    expect(source).toContain("insert(messageMentions)");
    expect(source).toContain("insertMentionParticipants");
    expect(source).toContain("markSenderParticipantRead");
    expect(source).toContain("dispatchAgentMentions");
    expect(source.indexOf("await insertMentionParticipants")).toBeLessThan(
      source.indexOf("await dispatchAgentMentions"),
    );
  });

  it("routes no-mention messages to the default agent without double-dispatching mentioned messages", () => {
    expect(source).toContain("dispatchDefaultAgentTurn");
    expect(source).toContain("parsedMentions.length === 0");
    expect(source).toContain("hasAgentMentions");
  });

  it("publishes user messages to collaborative thread subscribers", () => {
    expect(source).toContain("notifyNewMessage");
    expect(source).toContain("messageId: row.id");
    expect(source).toContain("senderType");
    expect(source).toContain("senderId");
  });

  it("checks thread visibility against the caller's participation", () => {
    expect(source).toContain("callerVisibleThreadPredicate");
  });

  it("validates attachment references before persisting message metadata", () => {
    expect(source).toContain("canonicalizeMessageAttachmentMetadata");
    expect(source.indexOf("await canonicalizeMessageAttachmentMetadata")).toBeLessThan(
      source.indexOf(".insert(messages)"),
    );
    expect(source).toContain('extensions: { code: "BAD_USER_INPUT" }');
    expect(source).toContain("metadata: canonicalMetadata");
  });

  it("preserves sender defaults while allowing agent-authenticated senders", () => {
    expect(source).toContain('const senderType = i.senderType ?? "user"');
    expect(source).toContain('senderType === "agent"');
    expect(source).toContain("ctx.auth.agentId");
    expect(source).toContain("Agent sender is not available in this tenant");
  });

  it("refreshes activity for Space collaboration user messages", () => {
    expect(source).toContain("const messageActivityAt = new Date()");
    expect(source).toContain("created_at: messageActivityAt");
    expect(source).toContain("readAt: messageActivityAt");
    expect(source).toContain("updated_at: messageActivityAt");
    expect(source).toContain("notifyThreadUpdate");
  });
});
