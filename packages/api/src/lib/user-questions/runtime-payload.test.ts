/**
 * pending_user_questions runtime-payload plumbing (plan 2026-06-09-005 U3).
 *
 * Unit tests for the camelCase → snake_case conversion + payload parsing,
 * plus source-contract assertions pinning the handler wiring on both
 * delivery routes (sendMessage direct dispatch via chat-agent-invoke; card
 * wakeup via wakeup-processor). The actual prompt block is U4 — these
 * tests only guard field delivery.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pendingQuestionAnswersFromPayload,
  toRuntimePendingUserQuestions,
} from "./runtime-payload.js";

const chatAgentInvokeSource = readFileSync(
  new URL("../../handlers/chat-agent-invoke.ts", import.meta.url),
  "utf8",
);
const wakeupProcessorSource = readFileSync(
  new URL("../../handlers/wakeup-processor.ts", import.meta.url),
  "utf8",
);

describe("toRuntimePendingUserQuestions", () => {
  it("converts to the snake_case runtime field shape (like message_attachments)", () => {
    expect(
      toRuntimePendingUserQuestions({
        questionId: "q-1",
        questions: [{ question: "Which env?" }],
        answers: { env: "Dev" },
        answeredVia: "card",
        answeredBy: "user-1",
        delegationContext: { profileSlug: "researcher" },
      }),
    ).toEqual({
      question_id: "q-1",
      questions: [{ question: "Which env?" }],
      answers: { env: "Dev" },
      answered_via: "card",
      answered_by: "user-1",
      reply_message_id: null,
      reply_text: null,
      delegation_context: { profileSlug: "researcher" },
    });
  });

  it("carries the reply reference + text for reply-consumed batches", () => {
    expect(
      toRuntimePendingUserQuestions({
        questionId: "q-1",
        questions: [],
        answeredVia: "reply",
        replyMessageId: "msg-9",
        replyText: "Dev please",
      }),
    ).toMatchObject({
      answered_via: "reply",
      answers: null,
      reply_message_id: "msg-9",
      reply_text: "Dev please",
    });
  });
});

describe("pendingQuestionAnswersFromPayload", () => {
  it("round-trips a card wakeup payload (top-level fields)", () => {
    expect(
      pendingQuestionAnswersFromPayload({
        threadId: "thread-1",
        questionId: "q-1",
        questions: [{ question: "Which env?" }],
        answers: { env: "Dev" },
        answeredVia: "card",
        answeredBy: "user-1",
        delegationContext: null,
      }),
    ).toEqual({
      questionId: "q-1",
      questions: [{ question: "Which env?" }],
      answers: { env: "Dev" },
      answeredVia: "card",
      answeredBy: "user-1",
      replyMessageId: null,
      replyText: null,
      delegationContext: null,
    });
  });

  it("rejects payloads without a question id or a valid answeredVia", () => {
    expect(pendingQuestionAnswersFromPayload(null)).toBeNull();
    expect(pendingQuestionAnswersFromPayload({})).toBeNull();
    expect(pendingQuestionAnswersFromPayload({ questionId: "q-1" })).toBeNull();
    expect(
      pendingQuestionAnswersFromPayload({
        questionId: "q-1",
        answeredVia: "carrier-pigeon",
      }),
    ).toBeNull();
  });
});

describe("chat-agent-invoke delivery (reply route)", () => {
  it("forwards event.pendingQuestionAnswers as the snake_case pending_user_questions invoke field", () => {
    expect(chatAgentInvokeSource).toContain(
      "pending_user_questions: event.pendingQuestionAnswers",
    );
    expect(chatAgentInvokeSource).toContain(
      "toRuntimePendingUserQuestions(event.pendingQuestionAnswers)",
    );
  });

  it("keeps invocation_source 'chat_message' on the direct dispatch path", () => {
    // The reply route's turn stays a chat_message turn; only the card
    // route's wakeup-resume turn gets invocation_source 'question_answer'
    // (wakeup-processor copies wakeup.source onto the turn row).
    expect(chatAgentInvokeSource).toContain('"chat_message"');
    expect(chatAgentInvokeSource).not.toContain(
      'invocation_source: "question_answer"',
    );
  });
});

describe("wakeup-processor delivery (card route, source 'question_answer')", () => {
  it("stamps thread_turns.invocation_source from wakeup.source — 'question_answer' for resume wakeups", () => {
    expect(wakeupProcessorSource).toContain("invocation_source: wakeup.source");
    expect(wakeupProcessorSource).toContain('case "question_answer"');
  });

  it("attaches pending_user_questions for question_answer wakeups AND the chat_message fallback's nested context", () => {
    expect(wakeupProcessorSource).toContain(
      "pendingQuestionAnswersFromPayload(payload)",
    );
    expect(wakeupProcessorSource).toContain(
      "pendingQuestionAnswersFromPayload(payload?.pendingQuestionAnswers)",
    );
    expect(wakeupProcessorSource).toContain("pending_user_questions:");
  });

  it("does not insert a synthetic user message for question_answer wakeups (the answered card is the user input)", () => {
    expect(wakeupProcessorSource).toContain(
      "shouldInsertSyntheticWakeupUserMessage({",
    );
    expect(wakeupProcessorSource).toContain(
      'if (input.source === "question_answer") return false',
    );
  });

  it("posts the resume turn's response back into the thread like chat turns", () => {
    expect(wakeupProcessorSource).toContain(
      'wakeup.source === "question_answer"',
    );
  });
});
