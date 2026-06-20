/**
 * answerUserQuestion — card answer route (plan 2026-06-09-005 U3, R22).
 *
 * Covers: auth/visibility (same-tenant non-participant rejected),
 * already-answered double submit, the lost-CAS-race path, the resume
 * wakeup contract (idempotency_key `question-answer:<id>`, TOP-LEVEL
 * threadId in the payload — the key promoteNextDeferredWakeup matches on
 * — and defer-awareness), and loud enqueue failure (no silent success).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const QUESTION_ID = "11111111-aaaa-1111-aaaa-111111111111";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  tables: {
    pendingUserQuestions: {
      __table__: "pending_user_questions",
      id: { name: "id" },
      thread_id: { name: "thread_id" },
      status: { name: "status" },
    },
    threads: {
      __table__: "threads",
      id: { name: "id" },
      tenant_id: { name: "tenant_id" },
      agent_id: { name: "agent_id" },
      status: { name: "status" },
      title: { name: "title" },
    },
    agentWakeupRequests: {
      __table__: "agent_wakeup_requests",
      id: { name: "id" },
      tenant_id: { name: "tenant_id" },
      agent_id: { name: "agent_id" },
      idempotency_key: { name: "idempotency_key" },
    },
  },
  questionRow: null as Record<string, unknown> | null,
  visibleThreadRows: [] as Array<Record<string, unknown>>,
  threadRow: null as Record<string, unknown> | null,
  existingWakeupRows: [] as Array<{ id: string }>,
  insertedWakeups: [] as Array<Record<string, unknown>>,
  insertError: null as Error | null,
  insertReturning: [{ id: "wakeup-1" }] as Array<{ id: string }>,
  resolveCallerFromAuth: vi.fn(),
  shouldDeferWakeup: vi.fn(),
  consumePendingQuestions: vi.fn(),
  notifyThreadUpdate: vi.fn(),
  finalizeN8nAgentStepRun: vi.fn(),
  visiblePredicate: vi.fn(() => ({ __visiblePredicate: true })),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          const resolve = async () => {
            if (table === mocks.tables.pendingUserQuestions) {
              return mocks.questionRow ? [mocks.questionRow] : [];
            }
            if (table === mocks.tables.threads) {
              // The visibility probe selects only { id }; the wakeup-agent
              // probe selects { agent_id, status, title }.
              if (selection && "agent_id" in selection) {
                return mocks.threadRow ? [mocks.threadRow] : [];
              }
              return mocks.visibleThreadRows;
            }
            if (table === mocks.tables.agentWakeupRequests) {
              return mocks.existingWakeupRows;
            }
            return [];
          };
          const promise = resolve();
          return Object.assign(promise, { limit: () => resolve() });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          expect(table).toBe(mocks.tables.agentWakeupRequests);
          if (mocks.insertError) throw mocks.insertError;
          mocks.insertedWakeups.push(values);
          return mocks.insertReturning;
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  pendingUserQuestions: mocks.tables.pendingUserQuestions,
  threads: mocks.tables.threads,
  agentWakeupRequests: mocks.tables.agentWakeupRequests,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ __and: conditions }),
  eq: (field: unknown, value: unknown) => ({ __eq: { field, value } }),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: mocks.visiblePredicate,
}));

vi.mock("../../../lib/wakeup-defer.js", () => ({
  shouldDeferWakeup: mocks.shouldDeferWakeup,
}));

vi.mock("../../../lib/user-questions/consume.js", () => ({
  consumePendingQuestions: mocks.consumePendingQuestions,
}));

vi.mock("../../notify.js", () => ({
  notifyThreadUpdate: mocks.notifyThreadUpdate,
}));

vi.mock("../../../lib/n8n-agent-step/finalize.js", () => ({
  finalizeN8nAgentStepRun: mocks.finalizeN8nAgentStepRun,
}));

import { answerUserQuestion } from "./answerUserQuestion.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

function pendingQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUESTION_ID,
    tenant_id: TENANT_ID,
    thread_id: THREAD_ID,
    message_id: "message-1",
    thread_turn_id: "turn-1",
    status: "pending",
    questions: [{ question: "Which env?", header: "Env", options: [] }],
    answers: null,
    answered_via: null,
    answered_by: null,
    answered_at: null,
    delegation_context: { profileSlug: "researcher", escalationCount: 0 },
    ...overrides,
  };
}

function answeredRow(answers: Record<string, unknown>) {
  return pendingQuestionRow({
    status: "answered",
    answers,
    answered_via: "card",
    answered_by: USER_ID,
    answered_at: new Date("2026-06-10T12:00:00Z"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.questionRow = pendingQuestionRow();
  mocks.visibleThreadRows = [{ id: THREAD_ID }];
  mocks.threadRow = {
    agent_id: AGENT_ID,
    status: "in_progress",
    title: "Quarterly report",
  };
  mocks.existingWakeupRows = [];
  mocks.insertedWakeups = [];
  mocks.insertError = null;
  mocks.insertReturning = [{ id: "wakeup-1" }];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.shouldDeferWakeup.mockResolvedValue(false);
  mocks.consumePendingQuestions.mockImplementation(async (_db, input) => [
    answeredRow(input.answers as Record<string, unknown>),
  ]);
  mocks.notifyThreadUpdate.mockResolvedValue(undefined);
  mocks.finalizeN8nAgentStepRun.mockReset();
  mocks.finalizeN8nAgentStepRun.mockResolvedValue({
    action: "no_run",
    runId: null,
    status: null,
  });
});

async function expectGraphQLError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    extensions: { code },
  });
}

describe("answerUserQuestion — happy path (card route)", () => {
  it("CAS-consumes, enqueues the keyed resume wakeup, and returns the answered UserQuestion", async () => {
    const result = await answerUserQuestion(
      {},
      { questionId: QUESTION_ID, answers: JSON.stringify({ env: "Dev" }) },
      ctx,
    );

    // Consume contract: card route, thread-scoped, answeredBy the caller.
    expect(mocks.consumePendingQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.consumePendingQuestions.mock.calls[0][1]).toEqual({
      threadId: THREAD_ID,
      answeredVia: "card",
      answers: { env: "Dev" },
      answeredBy: USER_ID,
    });

    // Wakeup contract (R22 + producer-side defer contract).
    expect(mocks.insertedWakeups).toHaveLength(1);
    const wakeup = mocks.insertedWakeups[0];
    expect(wakeup).toMatchObject({
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      source: "question_answer",
      status: "queued",
      idempotency_key: `question-answer:${QUESTION_ID}`,
      requested_by_actor_type: "user",
      requested_by_actor_id: USER_ID,
    });
    // threadId must be a TOP-LEVEL payload key — the exact key
    // promoteNextDeferredWakeup() matches on (payload->>'threadId').
    expect((wakeup.payload as Record<string, unknown>).threadId).toBe(
      THREAD_ID,
    );
    expect(wakeup.payload).toMatchObject({
      questionId: QUESTION_ID,
      answers: { env: "Dev" },
      answeredVia: "card",
      delegationContext: { profileSlug: "researcher", escalationCount: 0 },
    });

    // Returned UserQuestion (GraphQL camel shape, answer state from the row).
    expect(result).toMatchObject({
      id: QUESTION_ID,
      threadId: THREAD_ID,
      messageId: "message-1",
      status: "ANSWERED",
      answeredVia: "CARD",
      answeredBy: USER_ID,
    });
    expect(JSON.parse(result.answers as string)).toEqual({ env: "Dev" });

    // The AWAITING_USER badge clears on this thread-update event.
    expect(mocks.notifyThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD_ID, tenantId: TENANT_ID }),
    );
    expect(mocks.finalizeN8nAgentStepRun).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      resolution: "human_input_resolved",
    });
  });

  it("inserts status 'deferred' when a turn is running (shouldDeferWakeup)", async () => {
    mocks.shouldDeferWakeup.mockResolvedValue(true);
    await answerUserQuestion(
      {},
      { questionId: QUESTION_ID, answers: "{}" },
      ctx,
    );
    expect(mocks.shouldDeferWakeup).toHaveBeenCalledWith(THREAD_ID);
    expect(mocks.insertedWakeups[0].status).toBe("deferred");
  });
});

describe("answerUserQuestion — already answered / CAS race", () => {
  it("double card submit: a non-pending row errors QUESTION_ALREADY_ANSWERED before the CAS", async () => {
    mocks.questionRow = pendingQuestionRow({ status: "answered" });
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "QUESTION_ALREADY_ANSWERED",
    );
    expect(mocks.consumePendingQuestions).not.toHaveBeenCalled();
    expect(mocks.insertedWakeups).toHaveLength(0);
  });

  it("a reply-consumed row errors QUESTION_ALREADY_ANSWERED (no recovery)", async () => {
    mocks.questionRow = pendingQuestionRow({
      status: "answered",
      answered_via: "reply",
      answered_by: USER_ID,
    });
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "QUESTION_ALREADY_ANSWERED",
    );
    expect(mocks.consumePendingQuestions).not.toHaveBeenCalled();
    expect(mocks.insertedWakeups).toHaveLength(0);
  });

  it("card-answered + resume wakeup already exists → QUESTION_ALREADY_ANSWERED (true double submit)", async () => {
    mocks.questionRow = answeredRow({ env: "Dev" });
    mocks.existingWakeupRows = [{ id: "wakeup-already-there" }];
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "QUESTION_ALREADY_ANSWERED",
    );
    expect(mocks.consumePendingQuestions).not.toHaveBeenCalled();
    expect(mocks.insertedWakeups).toHaveLength(0);
  });

  it("lost CAS race: zero rows consumed → QUESTION_ALREADY_ANSWERED, no wakeup", async () => {
    mocks.consumePendingQuestions.mockResolvedValue([]);
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "QUESTION_ALREADY_ANSWERED",
    );
    expect(mocks.insertedWakeups).toHaveLength(0);
  });
});

describe("answerUserQuestion — auth + access", () => {
  it("rejects a same-tenant NON-participant (thread-visibility predicate)", async () => {
    mocks.visibleThreadRows = [];
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "FORBIDDEN",
    );
    // The predicate was consulted with the question's tenant + the caller.
    expect(mocks.visiblePredicate).toHaveBeenCalledWith(TENANT_ID, USER_ID);
    expect(mocks.consumePendingQuestions).not.toHaveBeenCalled();
    expect(mocks.insertedWakeups).toHaveLength(0);
  });

  it("cross-tenant caller gets NOT_FOUND (no existence leak)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: "99999999-9999-9999-9999-999999999999",
    });
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "NOT_FOUND",
    );
  });

  it("missing question id gets NOT_FOUND", async () => {
    mocks.questionRow = null;
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "NOT_FOUND",
    );
  });

  it("unresolvable cognito identity gets UNAUTHENTICATED", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: null,
      tenantId: null,
    });
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "UNAUTHENTICATED",
    );
  });

  it("non-object answers payload gets BAD_USER_INPUT", async () => {
    await expectGraphQLError(
      answerUserQuestion(
        {},
        { questionId: QUESTION_ID, answers: "not json" },
        ctx,
      ),
      "BAD_USER_INPUT",
    );
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "[1]" }, ctx),
      "BAD_USER_INPUT",
    );
  });
});

describe("answerUserQuestion — enqueue failure is LOUD (R22)", () => {
  it("existing row under the idempotency key (inserted=false) → WAKEUP_ENQUEUE_FAILED", async () => {
    mocks.existingWakeupRows = [{ id: "stale-wakeup" }];
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "WAKEUP_ENQUEUE_FAILED",
    );
    // The CAS already committed — the question row stays answered; the
    // mutation error is the card's retry signal (manual re-trigger is the
    // v1 recovery; reconciler deferred).
    expect(mocks.consumePendingQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.insertedWakeups).toHaveLength(0);
  });

  it("insert failure → WAKEUP_ENQUEUE_FAILED (never silent success)", async () => {
    mocks.insertError = new Error("connection reset");
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "WAKEUP_ENQUEUE_FAILED",
    );
  });

  it("empty insert returning → WAKEUP_ENQUEUE_FAILED", async () => {
    mocks.insertReturning = [];
    await expectGraphQLError(
      answerUserQuestion({}, { questionId: QUESTION_ID, answers: "{}" }, ctx),
      "WAKEUP_ENQUEUE_FAILED",
    );
  });
});

describe("answerUserQuestion — recovery re-entry after enqueue failure", () => {
  it("retry after WAKEUP_ENQUEUE_FAILED succeeds and enqueues exactly once (no second CAS)", async () => {
    // First attempt: the CAS commits but the wakeup insert fails.
    mocks.insertError = new Error("connection reset");
    await expectGraphQLError(
      answerUserQuestion(
        {},
        { questionId: QUESTION_ID, answers: JSON.stringify({ env: "Dev" }) },
        ctx,
      ),
      "WAKEUP_ENQUEUE_FAILED",
    );
    expect(mocks.consumePendingQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.insertedWakeups).toHaveLength(0);

    // Retry: the row is now answered (card) and NO wakeup row exists —
    // recovery re-entry skips the CAS and finishes the enqueue.
    mocks.insertError = null;
    mocks.questionRow = answeredRow({ env: "Dev" });
    mocks.existingWakeupRows = [];

    const result = await answerUserQuestion(
      {},
      { questionId: QUESTION_ID, answers: JSON.stringify({ env: "Dev" }) },
      ctx,
    );

    // No second consume — the original CAS already committed.
    expect(mocks.consumePendingQuestions).toHaveBeenCalledTimes(1);
    // Exactly one wakeup enqueued, under the same idempotency key, with
    // the answers persisted on the row.
    expect(mocks.insertedWakeups).toHaveLength(1);
    expect(mocks.insertedWakeups[0]).toMatchObject({
      source: "question_answer",
      idempotency_key: `question-answer:${QUESTION_ID}`,
    });
    expect(mocks.insertedWakeups[0].payload).toMatchObject({
      threadId: THREAD_ID,
      questionId: QUESTION_ID,
      answers: { env: "Dev" },
      answeredVia: "card",
      answeredBy: USER_ID,
    });
    expect(result).toMatchObject({
      id: QUESTION_ID,
      status: "ANSWERED",
      answeredVia: "CARD",
    });
  });
});

describe("answerUserQuestion — notify failure is logged, not thrown", () => {
  it("notifyThreadUpdate rejection does not fail the mutation and logs the error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.notifyThreadUpdate.mockRejectedValue(new Error("appsync down"));

    const result = await answerUserQuestion(
      {},
      { questionId: QUESTION_ID, answers: JSON.stringify({ env: "Dev" }) },
      ctx,
    );

    // The wakeup is enqueued and the mutation still returns the row…
    expect(mocks.insertedWakeups).toHaveLength(1);
    expect(result).toMatchObject({ id: QUESTION_ID, status: "ANSWERED" });
    // …and the badge-clear failure is visible in logs.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("notifyThreadUpdate failed"),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
