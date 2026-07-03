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

  it("normalizes goal mode metadata before persisting and dispatches the resolved runtime budget", () => {
    expect(source).toContain("normalizeMessageGoalModeMetadata");
    expect(source).toContain("resolveTenantGoalTokenBudget");
    expect(source).toContain("toRuntimeGoalMode");
    expect(source.indexOf("normalizeMessageGoalModeMetadata")).toBeLessThan(
      source.indexOf(".insert(messages)"),
    );
    expect(source.indexOf("resolveTenantGoalTokenBudget")).toBeLessThan(
      source.indexOf(".insert(messages)"),
    );
    expect(source).toContain(
      "...(resolvedGoalMode ? { goalMode: resolvedGoalMode } : {})",
    );
    expect(source).not.toContain("tokenBudget: parsedMetadata");
  });

  it("rejects goal mode before persistence when it cannot dispatch the default agent", () => {
    expect(source).toContain("Goal mode requires default agent dispatch.");
    expect(
      source.indexOf("Goal mode requires default agent dispatch"),
    ).toBeLessThan(source.indexOf(".insert(messages)"));
    expect(source).toContain(
      "!resolvedGoalMode &&\n    shouldApplyCustomerOnboardingChatUpdate",
    );
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

describe("sendMessage per-user activity fan-out (plan 2026-07-03-003 U1, R8-R11)", () => {
  it("calls publishThreadActivity post-commit after notifyNewMessage", () => {
    expect(source).toContain("publishThreadActivity");
    // Fan-out runs after the transaction commits and after the new-message
    // notify — the participant rows are already durable at this point.
    expect(source.indexOf("return messageRow;")).toBeLessThan(
      source.indexOf("publishThreadActivity({"),
    );
    expect(source.indexOf("notifyNewMessage({")).toBeLessThan(
      source.indexOf("publishThreadActivity({"),
    );
  });

  it("passes the user-mention target ids so a freshly-tagged user is in the fan-out (R11)", () => {
    expect(source).toContain(
      '.filter((mention) => mention.targetType === "user")',
    );
    expect(source).toContain("mentionedUserIds,");
  });

  it("threads the author/thread payload through the fan-out", () => {
    const call = source.slice(source.indexOf("publishThreadActivity({"));
    expect(call).toContain("authorId: senderId ?? null");
    expect(call).toContain("authorType: senderType");
    expect(call).toContain("messageId: row.id");
    expect(call).toContain("createdAt: messageActivityAt.toISOString()");
  });
});

describe("sendMessage sender-as-participant upsert (plan 2026-07-03-003 U2, R13)", () => {
  it("upserts the human sender as a participant inside the message transaction", () => {
    // The upsert must live inside the db.transaction callback alongside the
    // message insert, so the participant row commits atomically with the
    // message (mode derivation reads a truthful participant set).
    expect(source).toContain('if (senderType === "user" && senderId) {');
    const txStart = source.indexOf("db.transaction");
    const upsertIdx = source.indexOf(
      'if (senderType === "user" && senderId) {',
    );
    const returnRowIdx = source.indexOf("return messageRow;");
    expect(txStart).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeGreaterThan(txStart);
    expect(upsertIdx).toBeLessThan(returnRowIdx);
  });

  it("inserts a source='sender' user participant with onConflictDoNothing", () => {
    // participant_type user + source sender + idempotent conflict handling ⇒
    // a sender without a row gets one; an existing participant is a no-op.
    expect(source).toContain('participant_type: "user"');
    expect(source).toContain('source: "sender"');
    // The sender upsert is the second threadParticipants insert (after the
    // mention-participants insert) and both are onConflictDoNothing.
    const senderInsert = source.slice(
      source.indexOf('if (senderType === "user" && senderId) {'),
    );
    expect(senderInsert).toContain(".insert(threadParticipants)");
    expect(senderInsert).toContain(".onConflictDoNothing()");
  });

  it("gates the upsert to human senders so agent/system senders never get rows", () => {
    // The senderType === "user" guard is the whole mechanism that keeps
    // agent/system senders out of thread_participants.
    expect(source).toMatch(
      /if \(senderType === "user" && senderId\) \{\s*\n\s*await tx\s*\n?\s*\.insert\(threadParticipants\)/,
    );
  });

  it("carries a null space for non-space threads (R14)", () => {
    // thread.space_id ?? null ⇒ non-space threads still get a participant row,
    // with a null space_id rather than being skipped.
    expect(source).toContain("space_id: thread.space_id ?? null");
  });

  it("upserts the sender before marking their participant row read", () => {
    // markSenderParticipantRead updates last_read_at on the sender's row; the
    // insert must precede it so a brand-new row exists to be stamped.
    expect(source.indexOf('source: "sender"')).toBeLessThan(
      source.indexOf("await markSenderParticipantRead("),
    );
  });
});

describe("sendMessage sync-dispatch failure stamp (plan 2026-07-03-003 U6, R7)", () => {
  it("stamps a failed dispatch state instead of only console.warn-ing (default route)", () => {
    // The default-dispatch catch must no longer be a bare console.warn — it
    // stamps messages.metadata.dispatch and pushes an update so the failure is
    // visible + retryable, never a silent drop.
    const defaultCatch = source.slice(
      source.indexOf("[sendMessage] default agent dispatch failed:"),
    );
    expect(defaultCatch).toContain("stampDispatchFailure({");
    expect(defaultCatch).toContain('route: "default"');
  });

  it("stamps a per-agent failed state on the mention route (not all-or-nothing)", () => {
    // dispatchAgentMentions can fail per-agent; the caller inspects results
    // for failures and names which agents failed in the stamped reason.
    expect(source).toContain("mentionResults");
    expect(source).toContain(".filter((result) => result.failed)");
    expect(source).toContain(
      "mention dispatch failed for agents:",
    );
    const mentionBlock = source.slice(
      source.indexOf("const mentionResults = await dispatchAgentMentions("),
    );
    expect(mentionBlock).toContain("stampDispatchFailure({");
    expect(mentionBlock).toContain('route: "mention"');
  });

  it("merges the dispatch stamp into existing metadata and pushes a message update", () => {
    // The helper reads current metadata, merges (never clobbers) the dispatch
    // key, writes it back tenant-scoped, and re-notifies via notifyNewMessage.
    const helper = source.slice(source.indexOf("async function stampDispatchFailure"));
    expect(helper).toContain("...existingMetadata");
    expect(helper).toContain('status: "failed"');
    expect(helper).toContain(".update(messages)");
    expect(helper).toContain("notifyNewMessage({");
  });
});

describe("sendMessage pending-question reply consumption (plan 2026-06-09-005 U3)", () => {
  it("CAS-consumes the pending batch with answeredVia 'reply' and the new message as the reference", () => {
    expect(source).toContain("consumePendingQuestions(db, {");
    expect(source).toContain('answeredVia: "reply"');
    expect(source).toContain("replyMessageId: row.id");
    expect(source).toContain("answers: null");
  });

  it("consumes BEFORE the dispatch-mode branch so BOTH dispatch paths see it", () => {
    // ANY user message consumes (origin R7) — including @agent-mention
    // replies, which dispatch via dispatchAgentMentions, not the default
    // path.
    expect(source.indexOf("await consumePendingQuestions")).toBeLessThan(
      source.indexOf("await dispatchAgentMentions"),
    );
    expect(source.indexOf("await consumePendingQuestions")).toBeLessThan(
      source.indexOf("await dispatchDefaultAgentChatTurn"),
    );
    // …and the answer context is attached to whichever dispatch fires.
    const attachments =
      source.split(
        "...(pendingQuestionAnswers ? { pendingQuestionAnswers } : {})",
      ).length - 1;
    expect(attachments).toBe(2); // mention dispatch + default dispatch
  });

  it("logs consume failures at error level with thread context (message still sends)", () => {
    expect(source).toContain(
      "pending-question consume failed for thread=${i.threadId}",
    );
    expect(source).toMatch(
      /console\.error\(\s*`\[sendMessage\] pending-question consume failed/,
    );
    expect(source).not.toMatch(
      /console\.warn\([^)]*pending-question consume failed/,
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

describe("sendMessage tri-state dispatch wiring (plan 2026-07-03-003 U4, R1/R4/R5)", () => {
  it("exposes agentDispatch on SendMessageInput with the AgentDispatchRequest enum", () => {
    expect(messagesGraphql).toContain("agentDispatch: AgentDispatchRequest");
    expect(messagesGraphql).toContain("enum AgentDispatchRequest");
  });

  it("computes the dispatch Thread Mode post-commit with no extra ids — the transition message that @mentions a second human counts its own mention participants and does not auto-dispatch (R2/KTD2)", () => {
    const postCommit = source.indexOf("const dispatchThreadMode =");
    const transactionEnd = source.indexOf("const row = await db.transaction");
    expect(postCommit).toBeGreaterThan(transactionEnd);
    const block = source.slice(postCommit, source.indexOf("shouldDispatchDefaultAgentTurn", postCommit));
    expect(block).toContain("resolveDispatchThreadMode");
    expect(block).not.toContain("extraUserIds");
  });

  it("passes agentDispatch and threadMode into the default dispatch gate", () => {
    const gateCall = source.slice(source.lastIndexOf("shouldDispatchDefaultAgentTurn({"));
    expect(gateCall).toContain("agentDispatch: i.agentDispatch");
    expect(gateCall).toContain("threadMode: dispatchThreadMode");
  });

  it("gates mention dispatch on explicit FORCE_OFF only (legacy boolean keeps mention-wins)", () => {
    expect(source).toContain(
      "!shouldSuppressAgentMentionDispatch({ agentDispatch: i.agentDispatch })",
    );
  });

  it("predicts the pre-transaction goal-mode check by unioning sender and user mentions", () => {
    const goalCheck = source.indexOf("Goal mode requires default agent dispatch");
    const before = source.slice(0, goalCheck);
    expect(before).toContain("extraUserIds");
    expect(before).toContain('senderType === "user" ? senderId : null');
  });
});
