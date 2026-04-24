/**
 * TTL sweeper (plan §U11) auto-rejects MCP servers with
 * `status='pending' AND created_at < now() - 30 days`. Tests target the
 * handler's UPDATE payload shape — the actual SQL predicate is covered
 * by an integration/e2e test against a real Aurora in a follow-up.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdatePayload, mockUpdateReturning, mockWhereArgs } = vi.hoisted(
  () => ({
    mockUpdatePayload: vi.fn(),
    mockUpdateReturning: vi.fn(),
    mockWhereArgs: vi.fn(),
  }),
);

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        mockUpdatePayload(payload);
        return {
          where: (pred: unknown) => {
            mockWhereArgs(pred);
            return {
              returning: () =>
                Promise.resolve((mockUpdateReturning() as unknown[]) ?? []),
            };
          },
        };
      },
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMcpServers: {
    id: "id",
    tenant_id: "tenant_id",
    status: "status",
    created_at: "created_at",
    url_hash: "url_hash",
    approved_by: "approved_by",
    approved_at: "approved_at",
    updated_at: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ _lt: [col, val] }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/mcp-approval-sweeper.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateReturning.mockReturnValue([]);
});

describe("mcp-approval-sweeper", () => {
  it("writes status=rejected + clears approval metadata in the UPDATE", async () => {
    await handler();
    const payload = mockUpdatePayload.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      status: "rejected",
      url_hash: null,
      approved_by: null,
      approved_at: null,
    });
    expect(payload.updated_at).toBeInstanceOf(Date);
  });

  it("filters by status='pending' AND created_at < 30-day cutoff", async () => {
    const start = Date.now();
    await handler();
    const pred = mockWhereArgs.mock.calls[0]?.[0] as { _and: unknown[] };
    expect(pred).toBeDefined();
    const terms = pred._and as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(2);
    // eq(status, 'pending')
    const [eqTerm, ltTerm] = terms as [
      { _eq: [unknown, unknown] },
      { _lt: [unknown, Date] },
    ];
    expect(eqTerm._eq[1]).toBe("pending");
    // lt(created_at, now - 30 days)
    const cutoff = (ltTerm._lt[1] as Date).getTime();
    const expected = start - 30 * 24 * 60 * 60 * 1000;
    // Allow drift for the time the test takes.
    expect(cutoff).toBeGreaterThan(expected - 5000);
    expect(cutoff).toBeLessThan(expected + 5000);
  });

  it("reports auto_rejected count + rows in the result", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    mockUpdateReturning.mockReturnValue([
      { id: "s1", tenant_id: "t1", created_at: created },
      { id: "s2", tenant_id: "t1", created_at: created },
    ]);
    const res = await handler();
    expect(res.auto_rejected).toBe(2);
    expect(res.rows.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(res.rows[0]!.created_at).toBe(created.toISOString());
  });

  it("reports zero when nothing is stale", async () => {
    mockUpdateReturning.mockReturnValue([]);
    const res = await handler();
    expect(res.auto_rejected).toBe(0);
    expect(res.rows).toEqual([]);
  });
});
