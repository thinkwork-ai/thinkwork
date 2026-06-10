/**
 * consumePendingQuestions / cancelPendingQuestions — the CAS seam both
 * answer routes converge on (plan 2026-06-09-005 U3, R22).
 *
 * The executor mock implements real UPDATE … WHERE status='pending'
 * semantics over an in-memory row store, so the CAS race tests exercise
 * the actual one-winner property instead of stubbed return values.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  table: {
    thread_id: { name: "thread_id" },
    status: { name: "status" },
  },
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  pendingUserQuestions: mocks.table,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ __and: conditions }),
  eq: (field: unknown, value: unknown) => ({ __eq: { field, value } }),
}));

import { cancelPendingQuestions, consumePendingQuestions } from "./consume.js";

/**
 * Minimal executor implementing UPDATE … SET … WHERE thread_id=? AND
 * status=? RETURNING over mocks.rows. Applies synchronously (atomically),
 * mirroring Postgres row-level behavior for the race tests.
 */
function makeExecutor() {
  return {
    update: (table: unknown) => {
      expect(table).toBe(mocks.table);
      return {
        set: (values: Record<string, unknown>) => ({
          where: (cond: {
            __and: Array<{ __eq: { field: { name: string }; value: unknown } }>;
          }) => ({
            returning: async () => {
              const predicates = cond.__and.map((leaf) => leaf.__eq);
              const matched = mocks.rows.filter((row) =>
                predicates.every((p) => row[p.field.name] === p.value),
              );
              for (const row of matched) Object.assign(row, values);
              return matched.map((row) => ({ ...row }));
            },
          }),
        }),
      };
    },
  } as never;
}

const THREAD_ID = "33333333-3333-3333-3333-333333333333";

function pendingRow(id: string, threadId = THREAD_ID) {
  return {
    id,
    tenant_id: "tenant-1",
    thread_id: threadId,
    message_id: `msg-${id}`,
    status: "pending",
    questions: [{ question: "Which env?", header: "Env", options: [] }],
    answers: null,
    answered_via: null,
    answered_by: null,
    answered_at: null,
    delegation_context: null,
  };
}

beforeEach(() => {
  mocks.rows = [];
});

describe("consumePendingQuestions — CAS semantics", () => {
  it("flips the pending row to answered with card answers + answeredBy + answeredAt", async () => {
    mocks.rows = [pendingRow("q-1")];
    const consumed = await consumePendingQuestions(makeExecutor(), {
      threadId: THREAD_ID,
      answeredVia: "card",
      answers: { env: "Dev" },
      answeredBy: "user-1",
    });

    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toMatchObject({
      id: "q-1",
      status: "answered",
      answers: { env: "Dev" },
      answered_via: "card",
      answered_by: "user-1",
    });
    expect(consumed[0].answered_at).toBeInstanceOf(Date);
  });

  it("reply route records ONLY a reference to the consuming message, never answers", async () => {
    mocks.rows = [pendingRow("q-1")];
    const consumed = await consumePendingQuestions(makeExecutor(), {
      threadId: THREAD_ID,
      answeredVia: "reply",
      answers: null,
      replyMessageId: "msg-reply-9",
      answeredBy: "user-2",
    });

    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toMatchObject({
      status: "answered",
      answers: { replyMessageId: "msg-reply-9" },
      answered_via: "reply",
      answered_by: "user-2",
    });
  });

  it("consumes ALL pending rows for the thread (defensive against orphans), not one by id", async () => {
    mocks.rows = [pendingRow("q-1"), pendingRow("q-orphan")];
    const consumed = await consumePendingQuestions(makeExecutor(), {
      threadId: THREAD_ID,
      answeredVia: "card",
      answers: { ok: true },
      answeredBy: "user-1",
    });
    expect(consumed.map((row) => row.id).sort()).toEqual(["q-1", "q-orphan"]);
    expect(mocks.rows.every((row) => row.status === "answered")).toBe(true);
  });

  it("does not touch other threads' pending rows or this thread's non-pending rows", async () => {
    const otherThread = pendingRow("q-other", "other-thread");
    const alreadyAnswered = {
      ...pendingRow("q-done"),
      status: "answered",
    };
    mocks.rows = [pendingRow("q-1"), otherThread, alreadyAnswered];

    const consumed = await consumePendingQuestions(makeExecutor(), {
      threadId: THREAD_ID,
      answeredVia: "card",
      answers: {},
      answeredBy: "user-1",
    });
    expect(consumed.map((row) => row.id)).toEqual(["q-1"]);
    expect(otherThread.status).toBe("pending");
  });

  it("CAS race: two concurrent consumes → exactly one winner, loser gets an empty array", async () => {
    mocks.rows = [pendingRow("q-1")];
    const executor = makeExecutor();
    const [first, second] = await Promise.all([
      consumePendingQuestions(executor, {
        threadId: THREAD_ID,
        answeredVia: "card",
        answers: { route: "card" },
        answeredBy: "user-1",
      }),
      consumePendingQuestions(executor, {
        threadId: THREAD_ID,
        answeredVia: "reply",
        replyMessageId: "msg-reply",
        answeredBy: "user-2",
      }),
    ]);
    const results = [first, second].sort((a, b) => b.length - a.length);
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toHaveLength(0);
    // The committed row carries exactly one route's answer state.
    const row = mocks.rows[0];
    expect(row.status).toBe("answered");
    expect(["card", "reply"]).toContain(row.answered_via);
  });

  it("returns an empty array when nothing is pending (no-op, no throw)", async () => {
    mocks.rows = [];
    await expect(
      consumePendingQuestions(makeExecutor(), {
        threadId: THREAD_ID,
        answeredVia: "card",
        answers: {},
        answeredBy: "user-1",
      }),
    ).resolves.toEqual([]);
  });
});

describe("cancelPendingQuestions — cancel hygiene", () => {
  it("flips pending rows to cancelled and returns them", async () => {
    mocks.rows = [pendingRow("q-1")];
    const cancelled = await cancelPendingQuestions(makeExecutor(), {
      threadId: THREAD_ID,
    });
    expect(cancelled).toHaveLength(1);
    expect(mocks.rows[0].status).toBe("cancelled");
  });

  it("no-ops on already answered rows", async () => {
    mocks.rows = [{ ...pendingRow("q-1"), status: "answered" }];
    await expect(
      cancelPendingQuestions(makeExecutor(), { threadId: THREAD_ID }),
    ).resolves.toEqual([]);
    expect(mocks.rows[0].status).toBe("answered");
  });
});
