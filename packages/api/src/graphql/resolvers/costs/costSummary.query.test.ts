import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  requireAdminOrServiceCaller: vi.fn(async () => {}),
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => rows().then(resolve, reject),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  costEvents: {
    tenant_id: "cost_events.tenant_id",
    created_at: "cost_events.created_at",
    event_type: "cost_events.event_type",
    amount_usd: "cost_events.amount_usd",
    reconciliation_state: "cost_events.reconciliation_state",
    input_tokens: "cost_events.input_tokens",
    output_tokens: "cost_events.output_tokens",
    cached_read_tokens: "cost_events.cached_read_tokens",
    cached_write_tokens: "cost_events.cached_write_tokens",
    metadata: "cost_events.metadata",
    model: "cost_events.model",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  lte: (...args: unknown[]) => ({ _lte: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
  startOfMonth: () => new Date("2026-06-01T00:00:00.000Z"),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { costSummary } from "./costSummary.query.js";

beforeEach(() => {
  mocks.rows = [];
});

describe("costSummary", () => {
  it("returns visible totals and confidence-aware enforced totals", async () => {
    mocks.rows = [
      [
        {
          totalUsd: 17,
          llmUsd: 11,
          computeUsd: 4,
          toolsUsd: 1,
          evalUsd: 1,
          estimatedUsd: 9,
          invocationReconciledUsd: 5,
          billReconciledUsd: 3,
          mismatchUsd: 0,
          unreconciledUsd: 0,
          totalInputTokens: 1200,
          totalOutputTokens: 600,
          totalCachedReadTokens: 400,
          totalCachedWriteTokens: 100,
          systemUsd: 2,
          eventCount: 4,
        },
      ],
      [
        {
          model: "claude-sonnet-4-6",
          cachedReadTokens: 400,
          cachedWriteTokens: 100,
        },
      ],
    ];

    await expect(
      costSummary(
        null,
        {
          tenantId: "tenant-1",
          from: "2026-06-01T00:00:00.000Z",
          to: "2026-07-01T00:00:00.000Z",
        },
        {} as never,
      ),
    ).resolves.toMatchObject({
      totalUsd: 17,
      enforcedUsd: 17,
      estimatedUsd: 9,
      invocationReconciledUsd: 5,
      billReconciledUsd: 3,
      minimumReconciliationState: "runtime-reported",
      totalInputTokens: 1200,
      totalOutputTokens: 600,
      totalCachedReadTokens: 400,
      totalCachedWriteTokens: 100,
      // 400*0.30 + 100*3.75 per million
      cacheUsd: 0.000495,
      systemUsd: 2,
      conversationUsd: 15,
      eventCount: 4,
    });
    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "cost_summary:read",
    );
  });
});
