import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeMessageSenderType,
  shouldApplyCustomerOnboardingChatUpdate,
  shouldDispatchDefaultAgentTurn,
} from "./sendMessage.agent-handling.js";

const source = readFileSync(
  new URL("./sendMessage.mutation.ts", import.meta.url),
  "utf8",
);
const messagesGraphql = readFileSync(
  new URL(
    "../../../../../database-pg/graphql/types/messages.graphql",
    import.meta.url,
  ),
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

  it("routes eligible messages to the default agent without double-dispatching agent mentions", () => {
    expect(source).toContain("dispatchDefaultAgentChatTurn");
    expect(source).toContain("shouldDispatchDefaultAgentTurn");
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
    expect(
      source.indexOf("await canonicalizeMessageAttachmentMetadata"),
    ).toBeLessThan(source.indexOf(".insert(messages)"));
    expect(source).toContain('extensions: { code: "BAD_USER_INPUT" }');
    expect(source).toContain("metadata: canonicalMetadata");
  });

  it("validates selected parent models before persisting or dispatching", () => {
    expect(messagesGraphql).toContain("modelId: String");
    expect(source).toContain("resolveRequestedModelId");
    expect(source).toContain("assertUserModelApproved");
    expect(source.indexOf("await assertUserModelApproved")).toBeLessThan(
      source.indexOf(".insert(messages)"),
    );
    expect(source).toContain("withRequestedModelMetadata");
    expect(source).toContain("requestedModelId,");
  });

  it("preserves sender defaults while allowing agent-authenticated senders", () => {
    expect(source).toContain(
      "const senderType = normalizeMessageSenderType(i.senderType)",
    );
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

describe("sendMessage pending-question reply consumption (plan 2026-06-09-005 U3)", () => {
  it("CAS-consumes the pending batch with answeredVia 'reply' and the new message as the reference", () => {
    expect(source).toContain("consumePendingQuestions(db, {");
    expect(source).toContain('answeredVia: "reply"');
    expect(source).toContain("replyMessageId: row.id");
    expect(source).toContain("answers: null");
  });

  it("consumes BEFORE the dispatch it attaches the answer context to", () => {
    expect(source.indexOf("await consumePendingQuestions")).toBeLessThan(
      source.indexOf("await dispatchDefaultAgentChatTurn"),
    );
    expect(source).toContain(
      "...(pendingQuestionAnswers ? { pendingQuestionAnswers } : {})",
    );
  });

  it("does NOT enqueue a second wakeup from the reply path — the dispatched turn carries the answers", () => {
    // The card route (answerUserQuestion.mutation.ts) owns the resume
    // wakeup; sendMessage must never insert agent_wakeup_requests for a
    // consumed question.
    expect(source).not.toContain("agentWakeupRequests");
    expect(source).not.toContain("question-answer:");
  });

  it("keeps the #2013 attachment-resolution dispatch intact (consume must not bypass it)", () => {
    // The answer context rides the SAME dispatchDefaultAgentChatTurn call
    // that resolves message attachments inside default-agent-routing.ts —
    // there is exactly one dispatch call on this path.
    const dispatchCalls =
      source.split("dispatchDefaultAgentChatTurn(").length - 1;
    expect(dispatchCalls).toBe(1); // exactly one call site
    expect(source).toContain("canonicalizeMessageAttachmentMetadata");
  });
});

describe("sendMessage agent handling", () => {
  it("normalizes legacy mobile human senders into user dispatch", () => {
    expect(normalizeMessageSenderType(undefined)).toBe("user");
    expect(normalizeMessageSenderType("")).toBe("user");
    expect(normalizeMessageSenderType(" human ")).toBe("user");
    expect(normalizeMessageSenderType("USER")).toBe("user");
    expect(normalizeMessageSenderType("agent")).toBe("agent");
  });

  it("defaults user follow-ups into agent handling", () => {
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        hasAgentMentions: false,
      }),
    ).toBe(true);
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(true);
  });

  it("suppresses default agent handling when agentRequested is explicitly false", () => {
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        agentRequested: false,
        hasAgentMentions: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        agentRequested: false,
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(false);
  });

  it("keeps managed dispatch as the default dispatch mode", () => {
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        dispatchMode: "MANAGED_DEFAULT",
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(true);
  });

  it("does not expose desktop-local dispatch in the canonical GraphQL schema", () => {
    expect(messagesGraphql).toContain("enum MessageDispatchMode");
    expect(messagesGraphql).toContain("MANAGED_DEFAULT");
    expect(messagesGraphql).not.toContain("DESKTOP_LOCAL");
  });

  it("lets explicit agent mentions own dispatch even when default handling is suppressed", () => {
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        agentRequested: false,
        hasAgentMentions: true,
      }),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        agentRequested: false,
        hasAgentMentions: true,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(false);
  });

  it("does not treat collaborator mentions as a reason to skip default dispatch", () => {
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        agentRequested: true,
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(true);
  });

  it("keeps non-user senders, computer threads, and handled onboarding out of default dispatch", () => {
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "agent",
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        hasAgentMentions: false,
        hasComputerThread: true,
        customerOnboardingHandled: false,
      }),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        hasAgentMentions: false,
        hasComputerThread: false,
        customerOnboardingHandled: true,
      }),
    ).toBe(false);
  });
});
