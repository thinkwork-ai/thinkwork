import { describe, expect, it } from "vitest";

import {
  validateCanonicalQuestionAnswerTurn,
  type CanonicalQuestionAnswerParticipant,
  type CanonicalQuestionAnswerRecord,
  type CanonicalQuestionAnswerTurnTuple,
} from "./canonical-question-answer-turn.js";

const turn: CanonicalQuestionAnswerTurnTuple = {
  tenantId: "tenant-1",
  turnId: "turn-1",
  threadId: "thread-1",
  agentId: "agent-1",
  invocationSource: "question_answer",
  triggeringMessageId: null,
  runtimeType: "agentcore",
  status: "running",
  retryAttempt: 0,
  threadAgentId: "agent-1",
  spaceId: "space-1",
  agentTenantId: "tenant-1",
  wakeupTenantId: "tenant-1",
  wakeupAgentId: "agent-1",
  wakeupSource: "question_answer",
  wakeupPayload: { questionId: "question-1", threadId: "thread-1" },
  requestedByType: "user",
  requestedById: "user-1",
};

const answer: CanonicalQuestionAnswerRecord = {
  questionId: "question-1",
  questionTenantId: "tenant-1",
  questionThreadId: "thread-1",
  questionStatus: "answered",
  questions: [
    {
      header: "Scope",
      question: "Which segment?",
      options: [{ label: "Enterprise", description: "Large accounts" }],
    },
  ],
  answers: { Scope: "Enterprise" },
  answeredVia: "card",
  delegationContext: null,
  messageId: "assistant-question-message-1",
  answeredBy: "user-1",
  messageRole: "assistant",
  messageThreadId: "thread-1",
  messageTenantId: "tenant-1",
};

const participant: CanonicalQuestionAnswerParticipant = {
  userId: "user-1",
  userTenantId: "tenant-1",
  membershipId: "membership-1",
};

function validate(overrides?: {
  turn?: Partial<CanonicalQuestionAnswerTurnTuple>;
  answer?: Partial<CanonicalQuestionAnswerRecord>;
  participant?: Partial<CanonicalQuestionAnswerParticipant>;
}) {
  return validateCanonicalQuestionAnswerTurn({
    requestedTenantId: "tenant-1",
    requestedTurnId: "turn-1",
    turn: { ...turn, ...overrides?.turn },
    answer: { ...answer, ...overrides?.answer },
    participant: { ...participant, ...overrides?.participant },
  });
}

describe("validateCanonicalQuestionAnswerTurn", () => {
  it("accepts an exact answered-question action identity chain", () => {
    expect(validate()).toEqual({
      tenantId: "tenant-1",
      turnId: "turn-1",
      threadId: "thread-1",
      agentId: "agent-1",
      participantUserId: "user-1",
      anchorMessageId: "assistant-question-message-1",
      spaceId: "space-1",
      runtimeType: "agentcore",
      status: "running",
      retryAttempt: 0,
      pendingQuestionAnswer: {
        question_id: "question-1",
        questions: answer.questions,
        answers: { Scope: "Enterprise" },
        answered_via: "card",
        delegation_context: null,
      },
    });
  });

  it.each([
    ["cross-tenant turn", { turn: { tenantId: "tenant-2" } }],
    ["wrong wakeup source", { turn: { wakeupSource: "schedule" } }],
    ["non-user requester", { turn: { requestedByType: "agent" } }],
    [
      "mismatched thread payload",
      {
        turn: {
          wakeupPayload: { questionId: "question-1", threadId: "thread-2" },
        },
      },
    ],
    ["unanswered question", { answer: { questionStatus: "pending" } }],
    ["non-card answer", { answer: { answeredVia: "reply" } }],
    ["different answerer", { answer: { answeredBy: "user-2" } }],
    ["non-assistant card anchor", { answer: { messageRole: "user" } }],
    ["inactive participant", { participant: { membershipId: "" } }],
    ["different participant", { participant: { userId: "user-2" } }],
    ["message-backed turn", { turn: { triggeringMessageId: "message-1" } }],
  ])("rejects %s", (_label, overrides) => {
    expect(validate(overrides)).toBeNull();
  });
});
