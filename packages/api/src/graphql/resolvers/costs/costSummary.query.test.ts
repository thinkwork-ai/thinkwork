import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
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
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  lte: (...args: unknown[]) => ({ _lte: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
  startOfMonth: () => new Date("2026-06-01T00:00:00.000Z"),
}));

// eslint-disable-next-line import/first
import { costSummary } from "./costSummary.query.js";

beforeEach(() => {
  mocks.rows = [];
});

describe("costSummary", () => {
  it("returns visible totals and strict confidence-aware enforced totals", async () => {
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
          eventCount: 4,
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
      enforcedUsd: 3,
      estimatedUsd: 9,
      invocationReconciledUsd: 5,
      billReconciledUsd: 3,
      minimumReconciliationState: "bill-reconciled",
      totalInputTokens: 1200,
      totalOutputTokens: 600,
      eventCount: 4,
    });
  });
});
