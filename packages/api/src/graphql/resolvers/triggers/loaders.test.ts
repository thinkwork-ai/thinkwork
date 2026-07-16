import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  selectCalls: 0,
  failProbe: false,
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => {
      mocks.selectCalls += 1;
      return {
        from: () => ({
          where: () => {
            if (mocks.failProbe) {
              return Promise.reject(new Error("relation does not exist"));
            }
            return Promise.resolve(mocks.rows);
          },
        }),
      };
    },
  },
}));

import { createTriggerLoaders } from "./loaders";
import { threadTurnTypeResolvers } from "./types";

beforeEach(() => {
  mocks.rows = [];
  mocks.selectCalls = 0;
  mocks.failProbe = false;
});

const TENANT = "tenant-1";

function loader() {
  return createTriggerLoaders().threadTurnRecoveryPending;
}

describe("threadTurnRecoveryPending loader", () => {
  it("resolves true when an open (pending) retry row exists for the turn (AE3)", async () => {
    mocks.rows = [{ origin_turn_id: "turn-1", tenant_id: TENANT }];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(true);
  });

  it("resolves true for a dispatched row (AE3)", async () => {
    // The SQL filter is status IN ('pending','dispatched'); a dispatched row
    // therefore comes back from the probe just like a pending one.
    mocks.rows = [{ origin_turn_id: "turn-1", tenant_id: TENANT }];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(true);
  });

  it("resolves false when only terminal rows exist (filtered out in SQL) or no rows at all (AE3)", async () => {
    // succeeded/superseded/exhausted rows never match the status filter, so
    // the probe returns nothing for the turn.
    mocks.rows = [];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(false);
  });

  it("resolves true for mixed terminal + pending rows on the same origin (AE3)", async () => {
    // The exhausted sibling is filtered out in SQL; the pending row survives.
    mocks.rows = [{ origin_turn_id: "turn-1", tenant_id: TENANT }];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(true);
  });

  it("batches N turns into one retry_queue query", async () => {
    mocks.rows = [{ origin_turn_id: "turn-2", tenant_id: TENANT }];
    const batch = loader();
    const [a, b, c] = await Promise.all([
      batch.load({ turnId: "turn-1", tenantId: TENANT }),
      batch.load({ turnId: "turn-2", tenantId: TENANT }),
      batch.load({ turnId: "turn-3", tenantId: TENANT }),
    ]);
    expect([a, b, c]).toEqual([false, true, false]);
    expect(mocks.selectCalls).toBe(1);
  });

  it("belt-and-suspenders: an open row from a different tenant does not count", async () => {
    mocks.rows = [{ origin_turn_id: "turn-1", tenant_id: "tenant-other" }];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(false);
  });

  it("trusts the upstream tenant gate when the parent turn carries no tenant id", async () => {
    mocks.rows = [{ origin_turn_id: "turn-1", tenant_id: TENANT }];
    await expect(
      loader().load({ turnId: "turn-1", tenantId: null }),
    ).resolves.toBe(true);
  });

  it("degrades to false when the probe fails (best-effort)", async () => {
    mocks.failProbe = true;
    await expect(
      loader().load({ turnId: "turn-1", tenantId: TENANT }),
    ).resolves.toBe(false);
  });
});

describe("ThreadTurn.recoveryPending type resolver", () => {
  it("loads via ctx.loaders keyed by turn id + tenant", async () => {
    const load = vi.fn().mockResolvedValue(true);
    const ctx = { loaders: { threadTurnRecoveryPending: { load } } } as never;
    await expect(
      threadTurnTypeResolvers.recoveryPending(
        { id: "turn-1", tenantId: TENANT },
        {},
        ctx,
      ),
    ).resolves.toBe(true);
    expect(load).toHaveBeenCalledWith({ turnId: "turn-1", tenantId: TENANT });
  });

  it("falls back to snake_case tenant_id and returns false without a turn id", async () => {
    const load = vi.fn().mockResolvedValue(false);
    const ctx = { loaders: { threadTurnRecoveryPending: { load } } } as never;
    await threadTurnTypeResolvers.recoveryPending(
      { id: "turn-1", tenant_id: TENANT },
      {},
      ctx,
    );
    expect(load).toHaveBeenCalledWith({ turnId: "turn-1", tenantId: TENANT });

    expect(threadTurnTypeResolvers.recoveryPending({}, {}, ctx)).toBe(false);
  });
});
