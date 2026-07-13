/**
 * searchResearch — THINK-263 U9 "research rung".
 *
 * Exercises the pure orchestration (`runSearchResearch`) with injected deps:
 * the happy path creates a VISIBLE thread and dispatches in NORMAL mode (no
 * askMode); an existing `threadId` the caller cannot write to is FORBIDDEN
 * with NO dispatch and NO thread-create; a dispatch failure is surfaced
 * (logged) but the thread id still returns; a missing caller is FORBIDDEN; an
 * empty query is BAD_USER_INPUT before any write.
 */

import { describe, expect, it, vi } from "vitest";

import {
  runSearchResearch,
  type SearchResearchDeps,
  type ResearchThreadRecord,
} from "./searchResearch.mutation.js";

const TENANT = "tenant-1";
const USER = "user-1";

function record(
  overrides: Partial<ResearchThreadRecord> = {},
): ResearchThreadRecord {
  return {
    threadId: "thread-research-1",
    spaceId: "space-1",
    messageId: "message-1",
    ...overrides,
  };
}

function deps(overrides: Partial<SearchResearchDeps> = {}): {
  deps: SearchResearchDeps;
  created: Array<{ tenantId: string; userId: string; query: string }>;
  posted: Array<{
    tenantId: string;
    userId: string;
    threadId: string;
    query: string;
  }>;
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
  const posted: Array<{
    tenantId: string;
    userId: string;
    threadId: string;
    query: string;
  }> = [];
  const dispatched: Array<{
    tenantId: string;
    threadId: string;
    spaceId: string | null;
    messageId: string;
    content: string;
    userId: string;
  }> = [];
  const base: SearchResearchDeps = {
    createResearchThread: vi.fn(async (input) => {
      created.push(input);
      return record();
    }),
    postToExistingThread: vi.fn(async (input) => {
      posted.push(input);
      return record({ threadId: input.threadId });
    }),
    dispatchResearchTurn: vi.fn(async (input) => {
      dispatched.push(input);
    }),
    ...overrides,
  };
  return { deps: base, created, posted, dispatched };
}

describe("runSearchResearch (THINK-263 U9)", () => {
  it("happy path: creates a VISIBLE thread, dispatches in NORMAL mode, returns the id", async () => {
    const { deps: d, created, dispatched } = deps();
    const result = await runSearchResearch(
      { tenantId: TENANT, callerUserId: USER, query: "  what is our churn?  " },
      d,
    );

    expect(result).toEqual({ threadId: "thread-research-1" });
    // Thread created for the caller, query trimmed.
    expect(created).toEqual([
      { tenantId: TENANT, userId: USER, query: "what is our churn?" },
    ]);
    // Dispatched with the caller as sender + owner.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      tenantId: TENANT,
      threadId: "thread-research-1",
      messageId: "message-1",
      content: "what is our churn?",
      userId: USER,
    });
    // No target thread → the existing-thread post path is never taken.
    expect(d.postToExistingThread).not.toHaveBeenCalled();
  });

  it("target thread: posts into an authorized thread and dispatches there (no create)", async () => {
    const { deps: d, created, posted, dispatched } = deps();
    const result = await runSearchResearch(
      {
        tenantId: TENANT,
        callerUserId: USER,
        query: "dig into renewal risk",
        threadId: "thread-existing-9",
      },
      d,
    );

    expect(result).toEqual({ threadId: "thread-existing-9" });
    expect(created).toEqual([]);
    expect(posted).toEqual([
      {
        tenantId: TENANT,
        userId: USER,
        threadId: "thread-existing-9",
        query: "dig into renewal risk",
      },
    ]);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ threadId: "thread-existing-9" });
  });

  it("target thread with no write access: FORBIDDEN, NO dispatch, NO create", async () => {
    const {
      deps: d,
      created,
      dispatched,
    } = deps({
      // Real impl returns null when the caller cannot write to the thread.
      postToExistingThread: vi.fn(async () => null),
    });
    await expect(
      runSearchResearch(
        {
          tenantId: TENANT,
          callerUserId: USER,
          query: "peek",
          threadId: "thread-forbidden",
        },
        d,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(created).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(d.dispatchResearchTurn).not.toHaveBeenCalled();
  });

  it("missing caller user: FORBIDDEN before any write", async () => {
    const { deps: d, created } = deps();
    await expect(
      runSearchResearch(
        { tenantId: TENANT, callerUserId: null, query: "hi" },
        d,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(d.createResearchThread).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("empty query: BAD_USER_INPUT before any write", async () => {
    const { deps: d, created } = deps();
    await expect(
      runSearchResearch(
        { tenantId: TENANT, callerUserId: USER, query: "   " },
        d,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(created).toEqual([]);
  });

  it("dispatch failure is surfaced (logged) but the thread id still returns", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps: d } = deps({
      dispatchResearchTurn: vi.fn(async () => {
        throw new Error("lambda invoke failed");
      }),
    });
    const result = await runSearchResearch(
      { tenantId: TENANT, callerUserId: USER, query: "research" },
      d,
    );
    expect(result).toEqual({ threadId: "thread-research-1" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("research-turn dispatch failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
