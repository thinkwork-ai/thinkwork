/**
 * searchAsk — THINK-263 U6 "ask-turn machinery" (SERVER ONLY, INERT).
 *
 * Exercises the pure orchestration (`runSearchAsk`) with injected deps: the
 * over-budget gate blocks BEFORE any thread is created; the happy path creates
 * a hidden, owner-restricted thread and dispatches in ask mode; a missing
 * caller user is FORBIDDEN.
 */

import { describe, expect, it, vi } from "vitest";

import {
  runSearchAsk,
  type SearchAskDeps,
  type AskThreadRecord,
} from "./searchAsk.mutation.js";

const TENANT = "tenant-1";
const USER = "user-1";

function askRecord(overrides: Partial<AskThreadRecord> = {}): AskThreadRecord {
  return {
    threadId: "thread-hidden-1",
    spaceId: "space-1",
    messageId: "message-1",
    ...overrides,
  };
}

function deps(overrides: Partial<SearchAskDeps> = {}): {
  deps: SearchAskDeps;
  created: Array<{ tenantId: string; userId: string; query: string }>;
  dispatched: Array<{
    tenantId: string;
    threadId: string;
    spaceId: string | null;
    messageId: string;
    content: string;
    userId: string;
  }>;
} {
  const created: Array<{ tenantId: string; userId: string; query: string }> =
    [];
  const dispatched: Array<{
    tenantId: string;
    threadId: string;
    spaceId: string | null;
    messageId: string;
    content: string;
    userId: string;
  }> = [];
  const base: SearchAskDeps = {
    getBudgetStatus: vi.fn(async () => ({
      overBudget: false,
      spentUsd: 1,
      limitUsd: 100,
    })),
    createHiddenAskThread: vi.fn(async (input) => {
      created.push(input);
      return askRecord();
    }),
    dispatchAskTurn: vi.fn(async (input) => {
      dispatched.push(input);
    }),
    ...overrides,
  };
  return { deps: base, created, dispatched };
}

describe("runSearchAsk (THINK-263 U6)", () => {
  it("happy path: creates a hidden thread, dispatches in ask mode, returns the id", async () => {
    const { deps: d, created, dispatched } = deps();
    const result = await runSearchAsk(
      { tenantId: TENANT, callerUserId: USER, query: "  what is our churn?  " },
      d,
    );

    expect(result).toEqual({ threadId: "thread-hidden-1" });
    // Thread created for the caller, query trimmed.
    expect(created).toEqual([
      { tenantId: TENANT, userId: USER, query: "what is our churn?" },
    ]);
    // Dispatched with the caller as sender + owner.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      tenantId: TENANT,
      threadId: "thread-hidden-1",
      messageId: "message-1",
      content: "what is our churn?",
      userId: USER,
    });
  });

  it("over-budget: throws BUDGET_EXCEEDED and creates NO thread + NO dispatch", async () => {
    const {
      deps: d,
      created,
      dispatched,
    } = deps({
      getBudgetStatus: vi.fn(async () => ({
        overBudget: true,
        spentUsd: 120,
        limitUsd: 100,
      })),
    });
    await expect(
      runSearchAsk({ tenantId: TENANT, callerUserId: USER, query: "hi" }, d),
    ).rejects.toMatchObject({ extensions: { code: "BUDGET_EXCEEDED" } });
    expect(created).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("missing caller user: FORBIDDEN, budget never consulted", async () => {
    const { deps: d, created } = deps();
    await expect(
      runSearchAsk({ tenantId: TENANT, callerUserId: null, query: "hi" }, d),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(d.getBudgetStatus).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("empty query: BAD_USER_INPUT before any write", async () => {
    const { deps: d, created } = deps();
    await expect(
      runSearchAsk({ tenantId: TENANT, callerUserId: USER, query: "   " }, d),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(created).toEqual([]);
  });

  it("budget lookup failure fails OPEN — ask proceeds (invoke gate is backstop)", async () => {
    const { deps: d, dispatched } = deps({
      getBudgetStatus: vi.fn(async () => {
        throw new Error("budget service down");
      }),
    });
    const result = await runSearchAsk(
      { tenantId: TENANT, callerUserId: USER, query: "still ask" },
      d,
    );
    expect(result).toEqual({ threadId: "thread-hidden-1" });
    expect(dispatched).toHaveLength(1);
  });

  it("dispatch failure is surfaced (logged) but the thread id still returns", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps: d } = deps({
      dispatchAskTurn: vi.fn(async () => {
        throw new Error("lambda invoke failed");
      }),
    });
    const result = await runSearchAsk(
      { tenantId: TENANT, callerUserId: USER, query: "ask" },
      d,
    );
    expect(result).toEqual({ threadId: "thread-hidden-1" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ask-turn dispatch failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
