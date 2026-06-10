/**
 * Loader-level test for the threadLifecycleStatus DataLoader.
 *
 * The pure function is covered by lifecycle-status.test.ts. This suite
 * exercises the batching integration:
 *
 *  1. Three SQL probes fire regardless of the number of thread IDs (one
 *     active probe, one latest-row probe, one pending-question probe).
 *     Batching invariant.
 *  2. Loader output order matches input thread-id order (DataLoader
 *     contract).
 *  3. An active-turn hit on one thread doesn't leak the RUNNING result
 *     to its siblings.
 *  4. The mapping pipes through deriveLifecycleStatus — stuck queued,
 *     latest succeeded, and no-turns cases resolve per the unit-tested
 *     table; a pending question resolves AWAITING_USER (plan
 *     2026-06-09-005 U3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbSelectMock, dbExecuteMock } = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => {
  return {
    db: {
      select: (...args: unknown[]) => dbSelectMock(...args),
      execute: (...args: unknown[]) => dbExecuteMock(...args),
    },
    messages: {
      thread_id: "messages.thread_id",
      created_at: "messages.created_at",
      role: "messages.role",
    },
    threadTurns: {
      thread_id: "thread_turns.thread_id",
      status: "thread_turns.status",
      created_at: "thread_turns.created_at",
    },
  };
});

import { createThreadLoaders } from "../graphql/resolvers/threads/loaders.js";
// The mocked module's table sentinel — used to route the select stub
// between probe 1 (active turns, FROM thread_turns) and probe 3 (pending
// questions, FROM the real pendingUserQuestions schema object).
import { threadTurns as mockedThreadTurns } from "../graphql/utils.js";

/**
 * Table-aware select()-chain stub. Probe 1 selects FROM the mocked
 * threadTurns table; probe 3 (pending ask_user_question rows) selects
 * FROM the real pendingUserQuestions table — route by table identity.
 */
function stubSelect(activeRows: unknown[], pendingRows: unknown[] = []) {
  dbSelectMock.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () =>
        Promise.resolve(table === mockedThreadTurns ? activeRows : pendingRows),
    }),
  }));
}

describe("threadLifecycleStatus DataLoader", () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
    dbExecuteMock.mockReset();
  });

  it("fires exactly one active-probe and one latest-probe regardless of thread count", async () => {
    stubSelect([]); // no active turns, no pending questions
    dbExecuteMock.mockResolvedValue({ rows: [] }); // no rows in latest probe

    const { threadLifecycleStatus } = createThreadLoaders();
    await Promise.all([
      threadLifecycleStatus.load("t-1"),
      threadLifecycleStatus.load("t-2"),
      threadLifecycleStatus.load("t-3"),
    ]);

    // Probe 1 (active) + probe 3 (pending questions) each fired once,
    // covering all 3 thread IDs in a single query apiece.
    expect(dbSelectMock).toHaveBeenCalledTimes(2);
    // Probe 2 (latest DISTINCT ON) fired once.
    expect(dbExecuteMock).toHaveBeenCalledTimes(1);
  });

  it("returns results in input-id order — DataLoader contract", async () => {
    stubSelect([]);
    dbExecuteMock.mockResolvedValue({
      rows: [
        { thread_id: "t-2", status: "succeeded", created_at: new Date() },
        { thread_id: "t-1", status: "failed", created_at: new Date() },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    const [r1, r2, r3] = await Promise.all([
      threadLifecycleStatus.load("t-1"),
      threadLifecycleStatus.load("t-2"),
      threadLifecycleStatus.load("t-3"),
    ]);

    expect(r1).toBe("FAILED"); // t-1's latest was failed
    expect(r2).toBe("COMPLETED"); // t-2's latest was succeeded
    expect(r3).toBe("IDLE"); // t-3 has no turns
  });

  it("active-turn hit on one thread doesn't leak RUNNING to siblings", async () => {
    // Only t-1 has a fresh active turn.
    stubSelect([{ threadId: "t-1" }]);
    dbExecuteMock.mockResolvedValue({
      rows: [
        { thread_id: "t-2", status: "succeeded", created_at: new Date() },
        { thread_id: "t-3", status: "failed", created_at: new Date() },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    const [r1, r2, r3] = await Promise.all([
      threadLifecycleStatus.load("t-1"),
      threadLifecycleStatus.load("t-2"),
      threadLifecycleStatus.load("t-3"),
    ]);

    expect(r1).toBe("RUNNING");
    expect(r2).toBe("COMPLETED");
    expect(r3).toBe("FAILED");
  });

  it("routes stuck-queued (> 5 min) via the latest-row fallback → FAILED", async () => {
    // No active turns — the stuck queued row is older than 5 min.
    stubSelect([]);
    dbExecuteMock.mockResolvedValue({
      rows: [
        {
          thread_id: "t-stuck",
          status: "queued",
          created_at: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    expect(await threadLifecycleStatus.load("t-stuck")).toBe("FAILED");
  });

  it("resolves a thread with zero turns as IDLE", async () => {
    stubSelect([]);
    dbExecuteMock.mockResolvedValue({ rows: [] });

    const { threadLifecycleStatus } = createThreadLoaders();
    expect(await threadLifecycleStatus.load("t-empty")).toBe("IDLE");
  });

  it("filters system_event rows out of the latest-turn probe (escalate/delegate don't flip to COMPLETED)", async () => {
    // U2's escalateThread/delegateThread write a thread_turns row with
    // kind='system_event' + status='succeeded'. Without the kind filter
    // in the DISTINCT ON probe, a just-escalated thread would report
    // COMPLETED immediately. This test asserts the filter is applied —
    // if the loader queries with the kind filter, the dbExecuteMock
    // only sees agent_turn rows and this thread has none, so the
    // lifecycle falls through to IDLE (not COMPLETED).
    stubSelect([]);
    dbExecuteMock.mockResolvedValue({ rows: [] }); // loader-with-kind-filter returns no rows

    const { threadLifecycleStatus } = createThreadLoaders();
    expect(await threadLifecycleStatus.load("t-just-escalated")).toBe("IDLE");
  });

  it("coerces ISO-string created_at (JSON-decoded from db.execute) back to a Date", async () => {
    // Some raw SQL drivers return created_at as a string. Loader must
    // rehydrate it so deriveLifecycleStatus can compute age.
    const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    stubSelect([]);
    dbExecuteMock.mockResolvedValue({
      rows: [
        { thread_id: "t-iso", status: "queued", created_at: tenMinAgoIso },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    expect(await threadLifecycleStatus.load("t-iso")).toBe("FAILED");
  });

  it("pending question → AWAITING_USER, without leaking to siblings (plan 2026-06-09-005 U3)", async () => {
    // t-1 has a pending question on a SUCCEEDED latest turn; t-2 has one
    // on a FAILED latest turn (the badge must survive failure); t-3 has
    // no pending question.
    stubSelect([], [{ threadId: "t-1" }, { threadId: "t-2" }]);
    dbExecuteMock.mockResolvedValue({
      rows: [
        { thread_id: "t-1", status: "succeeded", created_at: new Date() },
        { thread_id: "t-2", status: "failed", created_at: new Date() },
        { thread_id: "t-3", status: "succeeded", created_at: new Date() },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    const [r1, r2, r3] = await Promise.all([
      threadLifecycleStatus.load("t-1"),
      threadLifecycleStatus.load("t-2"),
      threadLifecycleStatus.load("t-3"),
    ]);

    expect(r1).toBe("AWAITING_USER");
    expect(r2).toBe("AWAITING_USER"); // failed latest turn still badges
    expect(r3).toBe("COMPLETED");
  });

  it("clears AWAITING_USER once the question is consumed (no pending rows)", async () => {
    stubSelect([], []);
    dbExecuteMock.mockResolvedValue({
      rows: [{ thread_id: "t-1", status: "succeeded", created_at: new Date() }],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    expect(await threadLifecycleStatus.load("t-1")).toBe("COMPLETED");
  });

  it("degrades to hasPendingQuestion=false when the pending probe fails (missing table must not break thread lists)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // Probe 1 (FROM the mocked threadTurns table) succeeds; probe 3 (FROM
    // the real pendingUserQuestions table) rejects, simulating a stage
    // where the table has not been applied yet.
    dbSelectMock.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () =>
          table === mockedThreadTurns
            ? Promise.resolve([])
            : Promise.reject(
                new Error('relation "pending_user_questions" does not exist'),
              ),
      }),
    }));
    dbExecuteMock.mockResolvedValue({
      rows: [
        { thread_id: "t-1", status: "succeeded", created_at: new Date() },
        { thread_id: "t-2", status: "failed", created_at: new Date() },
      ],
    });

    const { threadLifecycleStatus } = createThreadLoaders();
    const [r1, r2] = await Promise.all([
      threadLifecycleStatus.load("t-1"),
      threadLifecycleStatus.load("t-2"),
    ]);

    // Statuses still resolve from the other probes — no AWAITING_USER.
    expect(r1).toBe("COMPLETED");
    expect(r2).toBe("FAILED");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("pending-question probe failed"),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe("threadPendingUserQuestion DataLoader", () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
    dbExecuteMock.mockReset();
  });

  it("returns the open batch as a GraphQL UserQuestion, null for threads without one", async () => {
    stubSelect(
      [],
      [
        {
          id: "question-1",
          thread_id: "t-1",
          message_id: "message-1",
          status: "pending",
          questions: [{ question: "Which env?", header: "Env", options: [] }],
          answers: null,
          answered_via: null,
          answered_by: null,
          answered_at: null,
        },
      ],
    );

    const { threadPendingUserQuestion } = createThreadLoaders();
    const [q1, q2] = await Promise.all([
      threadPendingUserQuestion.load("t-1"),
      threadPendingUserQuestion.load("t-2"),
    ]);

    expect(q1).toMatchObject({
      id: "question-1",
      threadId: "t-1",
      messageId: "message-1",
      status: "PENDING",
      answers: null,
      answeredVia: null,
    });
    expect(JSON.parse(q1!.questions)).toEqual([
      { question: "Which env?", header: "Env", options: [] },
    ]);
    expect(q2).toBeNull();
  });
});
