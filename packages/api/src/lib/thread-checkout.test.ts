/**
 * THINK-324 C5 — thread checkout claim/release + stale-deferred sweep.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({ execute: mocks.execute }),
}));

import {
  claimThreadCheckout,
  releaseThreadCheckout,
} from "./thread-checkout.js";
import { promoteStaleDeferredWakeups } from "./wakeup-defer.js";

const CLAIM = {
  tenantId: "tenant-1",
  threadId: "thread-1",
  runId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.clearAllMocks();
});

/** Render a drizzle sql`` object as text with `?` for each bound parameter. */
function flattenSql(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        return value.join("");
      }
      return "?";
    })
    .join("");
}

describe("claimThreadCheckout", () => {
  it("returns true when the UPDATE claims the row", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: "thread-1" }] });
    await expect(claimThreadCheckout(CLAIM)).resolves.toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("returns false when a live holder keeps the lease (0 rows)", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(claimThreadCheckout(CLAIM)).resolves.toBe(false);
  });

  it("propagates claim-infra errors (callers decide fail-open)", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    await expect(claimThreadCheckout(CLAIM)).rejects.toThrow("db down");
  });

  it("never compares the text checkout_run_id column against a uuid value", async () => {
    // threads.checkout_run_id is a TEXT column. Casting the run-id parameter
    // to ::uuid made every claim/release fail with 42883 "operator does not
    // exist: text = uuid" — silently, because claim fails open and release is
    // best-effort, so the single-writer lease never actually engaged.
    mocks.execute.mockResolvedValue({ rows: [] });
    await claimThreadCheckout(CLAIM);
    await releaseThreadCheckout({ threadId: "thread-1", runId: CLAIM.runId });
    for (const call of mocks.execute.mock.calls) {
      const sqlText = flattenSql(call[0]);
      expect(sqlText).not.toMatch(/checkout_run_id = \?::uuid/);
    }
  });

  it("guards the liveness join so a non-uuid checkout_run_id cannot crash the cast", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await claimThreadCheckout(CLAIM);
    const sqlText = flattenSql(mocks.execute.mock.calls[0][0]);
    expect(sqlText).toContain("CASE");
    expect(sqlText).toContain("checkout_run_id ~");
  });

  it("steals only from dead holders: the guard checks running, unfinalized, and recent activity", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await claimThreadCheckout(CLAIM);
    const query = mocks.execute.mock.calls[0][0] as {
      queryChunks?: unknown[];
    };
    const sqlText = JSON.stringify(query);
    expect(sqlText).toContain("checkout_run_id IS NULL");
    expect(sqlText).toContain("tt.status = 'running'");
    expect(sqlText).toContain("tt.finalized_at IS NULL");
    expect(sqlText).toContain("tt.last_activity_at > NOW()");
  });
});

describe("releaseThreadCheckout", () => {
  it("releases only when this run holds the lease", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await releaseThreadCheckout({
      threadId: CLAIM.threadId,
      runId: CLAIM.runId,
    });
    const sqlText = JSON.stringify(mocks.execute.mock.calls[0][0]);
    expect(sqlText).toContain("checkout_run_id = ");
    expect(sqlText).toContain("checkout_run_id = NULL");
  });

  it("never throws (best-effort; stale-steal self-heals)", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    await expect(
      releaseThreadCheckout({ threadId: CLAIM.threadId, runId: CLAIM.runId }),
    ).resolves.toBeUndefined();
  });
});

describe("promoteStaleDeferredWakeups", () => {
  it("returns the number of promoted wakeups", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: "w-1" }, { id: "w-2" }] });
    await expect(promoteStaleDeferredWakeups()).resolves.toBe(2);
  });

  it("returns 0 and never throws on sweep failure", async () => {
    mocks.execute.mockRejectedValue(new Error("db down"));
    await expect(promoteStaleDeferredWakeups()).resolves.toBe(0);
  });
});
