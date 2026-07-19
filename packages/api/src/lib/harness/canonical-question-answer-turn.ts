import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentWakeupRequests,
  messages,
  pendingUserQuestions,
  threadParticipants,
  threads,
  threadTurns,
  users,
} from "@thinkwork/database-pg/schema";

export interface CanonicalQuestionAnswerTurn {
  tenantId: string;
  turnId: string;
  threadId: string;
  agentId: string;
  participantUserId: string;
  anchorMessageId: string;
  spaceId: string | null;
  runtimeType: string | null;
  status: string;
  retryAttempt: number;
  pendingQuestionAnswer: Record<string, unknown>;
}

export interface CanonicalQuestionAnswerTurnTuple {
  tenantId: string;
  turnId: string;
  threadId: string | null;
  agentId: string | null;
  invocationSource: string | null;
  triggeringMessageId: string | null;
  runtimeType: string | null;
  status: string;
  retryAttempt: number | null;
  threadAgentId: string | null;
  spaceId: string | null;
  agentTenantId: string | null;
  wakeupTenantId: string | null;
  wakeupAgentId: string | null;
  wakeupSource: string | null;
  wakeupPayload: unknown;
  requestedByType: string | null;
  requestedById: string | null;
}

export interface CanonicalQuestionAnswerRecord {
  questionId: string;
  questionTenantId: string;
  questionThreadId: string;
  questionStatus: string;
  questions: unknown;
  answers: unknown;
  answeredVia: string | null;
  delegationContext: unknown;
  messageId: string;
  answeredBy: string | null;
  messageRole: string;
  messageThreadId: string;
  messageTenantId: string;
}

export interface CanonicalQuestionAnswerParticipant {
  userId: string;
  userTenantId: string | null;
  membershipId: string;
}

/**
 * Pure fail-closed validation for the canonical action identity chain. Keeping
 * this separate from the query makes every cross-tenant and cross-user fence
 * directly testable without weakening the database predicates.
 */
export function validateCanonicalQuestionAnswerTurn(input: {
  requestedTenantId: string;
  requestedTurnId: string;
  turn: CanonicalQuestionAnswerTurnTuple | null | undefined;
  answer: CanonicalQuestionAnswerRecord | null | undefined;
  participant: CanonicalQuestionAnswerParticipant | null | undefined;
}): CanonicalQuestionAnswerTurn | null {
  const { turn, answer, participant } = input;
  if (
    !turn?.threadId ||
    !turn.agentId ||
    turn.tenantId !== input.requestedTenantId ||
    turn.turnId !== input.requestedTurnId ||
    turn.invocationSource !== "question_answer" ||
    turn.triggeringMessageId != null ||
    turn.threadAgentId !== turn.agentId ||
    turn.agentTenantId !== turn.tenantId ||
    turn.wakeupTenantId !== turn.tenantId ||
    turn.wakeupAgentId !== turn.agentId ||
    turn.wakeupSource !== "question_answer" ||
    turn.requestedByType !== "user" ||
    !turn.requestedById ||
    !Number.isInteger(turn.retryAttempt ?? 0) ||
    (turn.retryAttempt ?? 0) < 0
  ) {
    return null;
  }

  const payload =
    turn.wakeupPayload &&
    typeof turn.wakeupPayload === "object" &&
    !Array.isArray(turn.wakeupPayload)
      ? (turn.wakeupPayload as Record<string, unknown>)
      : null;
  const questionId =
    payload && typeof payload.questionId === "string"
      ? payload.questionId
      : null;
  if (!questionId || payload?.threadId !== turn.threadId) return null;

  if (
    !answer ||
    answer.questionId !== questionId ||
    answer.questionTenantId !== turn.tenantId ||
    answer.questionThreadId !== turn.threadId ||
    answer.questionStatus !== "answered" ||
    answer.answeredVia !== "card" ||
    answer.answeredBy !== turn.requestedById ||
    answer.messageRole !== "assistant" ||
    answer.messageThreadId !== turn.threadId ||
    answer.messageTenantId !== turn.tenantId
  ) {
    return null;
  }

  if (
    !participant ||
    participant.userId !== turn.requestedById ||
    participant.userTenantId !== turn.tenantId ||
    !participant.membershipId
  ) {
    return null;
  }

  return {
    tenantId: turn.tenantId,
    turnId: turn.turnId,
    threadId: turn.threadId,
    agentId: turn.agentId,
    participantUserId: participant.userId,
    anchorMessageId: answer.messageId,
    spaceId: turn.spaceId,
    runtimeType: turn.runtimeType,
    status: turn.status,
    retryAttempt: turn.retryAttempt ?? 0,
    pendingQuestionAnswer: {
      question_id: answer.questionId,
      questions: answer.questions,
      answers: answer.answers,
      answered_via: answer.answeredVia,
      delegation_context: answer.delegationContext,
    },
  };
}

/**
 * Resolve the exact human identity behind a card-based question answer.
 *
 * Card answers intentionally do not create a duplicate visible user message.
 * Their canonical identity anchor is therefore the immutable chain
 * thread_turn -> question_answer wakeup -> answered pending question -> active
 * thread participant. The assistant question-card message is returned only as
 * the public-history anchor; it is never treated as the human identity source.
 */
export async function loadCanonicalQuestionAnswerTurn(input: {
  tenantId: string;
  turnId: string;
}): Promise<CanonicalQuestionAnswerTurn | null> {
  const database = getDb();
  const [turn] = await database
    .select({
      tenantId: threadTurns.tenant_id,
      turnId: threadTurns.id,
      threadId: threadTurns.thread_id,
      agentId: threadTurns.agent_id,
      invocationSource: threadTurns.invocation_source,
      triggeringMessageId: threadTurns.triggering_message_id,
      runtimeType: threadTurns.runtime_type,
      status: threadTurns.status,
      retryAttempt: threadTurns.retry_attempt,
      threadAgentId: threads.agent_id,
      spaceId: threads.space_id,
      agentTenantId: agents.tenant_id,
      wakeupTenantId: agentWakeupRequests.tenant_id,
      wakeupAgentId: agentWakeupRequests.agent_id,
      wakeupSource: agentWakeupRequests.source,
      wakeupPayload: agentWakeupRequests.payload,
      requestedByType: agentWakeupRequests.requested_by_actor_type,
      requestedById: agentWakeupRequests.requested_by_actor_id,
    })
    .from(threadTurns)
    .innerJoin(
      threads,
      and(
        eq(threads.id, threadTurns.thread_id),
        eq(threads.tenant_id, threadTurns.tenant_id),
      ),
    )
    .innerJoin(
      agents,
      and(
        eq(agents.id, threadTurns.agent_id),
        eq(agents.tenant_id, threadTurns.tenant_id),
      ),
    )
    .innerJoin(
      agentWakeupRequests,
      and(
        eq(agentWakeupRequests.id, threadTurns.wakeup_request_id),
        eq(agentWakeupRequests.tenant_id, threadTurns.tenant_id),
        eq(agentWakeupRequests.agent_id, threadTurns.agent_id),
      ),
    )
    .where(
      and(
        eq(threadTurns.id, input.turnId),
        eq(threadTurns.tenant_id, input.tenantId),
      ),
    )
    .limit(1);

  const payload =
    turn?.wakeupPayload &&
    typeof turn.wakeupPayload === "object" &&
    !Array.isArray(turn.wakeupPayload)
      ? (turn.wakeupPayload as Record<string, unknown>)
      : null;
  const questionId =
    payload && typeof payload.questionId === "string"
      ? payload.questionId
      : null;
  if (
    !turn?.threadId ||
    !turn.requestedById ||
    !questionId ||
    payload?.threadId !== turn.threadId
  ) {
    return null;
  }
  const threadId = turn.threadId;
  const requestedById = turn.requestedById;

  const [answer] = await database
    .select({
      questionId: pendingUserQuestions.id,
      questionTenantId: pendingUserQuestions.tenant_id,
      questionThreadId: pendingUserQuestions.thread_id,
      questionStatus: pendingUserQuestions.status,
      questions: pendingUserQuestions.questions,
      answers: pendingUserQuestions.answers,
      answeredVia: pendingUserQuestions.answered_via,
      delegationContext: pendingUserQuestions.delegation_context,
      messageId: pendingUserQuestions.message_id,
      answeredBy: pendingUserQuestions.answered_by,
      messageRole: messages.role,
      messageThreadId: messages.thread_id,
      messageTenantId: messages.tenant_id,
    })
    .from(pendingUserQuestions)
    .innerJoin(
      messages,
      and(
        eq(messages.id, pendingUserQuestions.message_id),
        eq(messages.thread_id, pendingUserQuestions.thread_id),
        eq(messages.tenant_id, pendingUserQuestions.tenant_id),
      ),
    )
    .where(
      and(
        eq(pendingUserQuestions.id, questionId),
        eq(pendingUserQuestions.tenant_id, turn.tenantId),
        eq(pendingUserQuestions.thread_id, threadId),
      ),
    )
    .limit(1);
  const [participant] = await database
    .select({
      userId: users.id,
      userTenantId: users.tenant_id,
      membershipId: threadParticipants.id,
    })
    .from(users)
    .innerJoin(
      threadParticipants,
      and(
        eq(threadParticipants.tenant_id, turn.tenantId),
        eq(threadParticipants.thread_id, threadId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, users.id),
      ),
    )
    .where(and(eq(users.id, requestedById), eq(users.tenant_id, turn.tenantId)))
    .limit(1);
  return validateCanonicalQuestionAnswerTurn({
    requestedTenantId: input.tenantId,
    requestedTurnId: input.turnId,
    turn,
    answer,
    participant,
  });
}
