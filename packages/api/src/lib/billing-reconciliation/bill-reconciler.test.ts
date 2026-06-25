import { describe, expect, it } from "vitest";
import {
  reconcileBillingAggregates,
  type BillingLineItemForReconciliation,
  type CostEventForBillingReconciliation,
} from "./bill-reconciler.js";

const costEventBase: CostEventForBillingReconciliation = {
  id: "cost-1",
  tenantId: "tenant-1",
  provider: "bedrock",
  serviceCode: "AmazonBedrock",
  operation: "Converse",
  model: "claude-sonnet-4-5",
  amountUsd: 0.42,
  createdAt: "2026-06-25T15:10:00.000Z",
  reconciliationState: "invocation-reconciled",
};

const billBase: BillingLineItemForReconciliation = {
  id: "bill-1",
  importId: "import-1",
  tenantId: "tenant-1",
  provider: "aws",
  serviceCode: "AmazonBedrock",
  operation: "Converse",
  model: "claude-sonnet-4-5",
  usageAccountId: "123456789012",
  usageStart: "2026-06-25T15:00:00.000Z",
  usageEnd: "2026-06-25T16:00:00.000Z",
  billingPeriodStart: "2026-06-01T00:00:00.000Z",
  billingPeriodEnd: "2026-07-01T00:00:00.000Z",
  amountUsd: 0.42,
  attributionLevel: "tenant",
  attributionKey: "tenant-1",
  sourceUri: "s3://billing-exports/manifest.json",
};

describe("reconcileBillingAggregates", () => {
  it("marks tenant-attributed cost rows bill-reconciled when CUR spend matches", () => {
    const [decision] = reconcileBillingAggregates([costEventBase], [billBase], {
      toleranceUsd: 0.01,
    });

    expect(decision).toMatchObject({
      state: "bill-reconciled",
      provider: "aws",
      serviceCode: "AmazonBedrock",
      model: "claude-sonnet-4-5",
      attributionLevel: "tenant",
      allocationConfidence: "exact-tenant",
      projectedAmountUsd: 0.42,
      billedAmountUsd: 0.42,
      varianceUsd: 0,
      costEventIdsToUpdate: ["cost-1"],
    });
  });

  it("upgrades aggregate confidence without erasing invocation evidence", () => {
    const [decision] = reconcileBillingAggregates(
      [
        {
          ...costEventBase,
          reconciliationState: "invocation-reconciled",
        },
      ],
      [billBase],
      { toleranceUsd: 0.01 },
    );

    expect(decision.previousCostEventStates).toEqual([
      {
        costEventId: "cost-1",
        reconciliationState: "invocation-reconciled",
      },
    ]);
    expect(decision.costEventIdsToUpdate).toEqual(["cost-1"]);
  });

  it("keeps account-only bill evidence aggregate-only", () => {
    const [decision] = reconcileBillingAggregates(
      [costEventBase],
      [
        {
          ...billBase,
          tenantId: null,
          attributionLevel: "account",
          attributionKey:
            "aws:123456789012:AmazonBedrock:Converse:claude-sonnet-4-5",
        },
      ],
      { toleranceUsd: 0.01 },
    );

    expect(decision).toMatchObject({
      state: "bill-reconciled",
      attributionLevel: "account",
      allocationConfidence: "aggregate-only",
      costEventIdsToUpdate: [],
    });
  });

  it("surfaces monthly billing variance outside tolerance as a mismatch", () => {
    const [decision] = reconcileBillingAggregates(
      [costEventBase],
      [{ ...billBase, amountUsd: 0.58 }],
      { toleranceUsd: 0.01 },
    );

    expect(decision).toMatchObject({
      state: "mismatch",
      projectedAmountUsd: 0.42,
      billedAmountUsd: 0.58,
      varianceUsd: 0.16,
      costEventIdsToUpdate: ["cost-1"],
    });
  });

  it("leaves historical runtime rows individually unreconciled when no bill proof exists", () => {
    const [decision] = reconcileBillingAggregates([costEventBase], [], {
      toleranceUsd: 0.01,
    });

    expect(decision).toMatchObject({
      state: "unreconciled/error",
      reason: "missing-bill-evidence",
      costEventIdsToUpdate: [],
      projectedAmountUsd: 0.42,
      billedAmountUsd: 0,
    });
  });
});
