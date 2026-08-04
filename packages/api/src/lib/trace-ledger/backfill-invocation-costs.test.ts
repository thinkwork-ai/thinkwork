import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({ getDb: () => ({}) }));

const { buildDailyAdjustmentEvent, computeDailyAdjustmentUsd } = await import(
  "./backfill-invocation-costs.js"
);

describe("computeDailyAdjustmentUsd", () => {
  it("returns the residual when provider exceeds recorded", () => {
    expect(computeDailyAdjustmentUsd(0.97, 0.12)).toBeCloseTo(0.85, 6);
  });

  it("returns 0 for sub-epsilon noise", () => {
    expect(computeDailyAdjustmentUsd(0.1000004, 0.1)).toBe(0);
  });

  it("returns 0 when recorded exceeds provider (never negative adjustments)", () => {
    expect(computeDailyAdjustmentUsd(0.1, 0.5)).toBe(0);
  });
});

describe("buildDailyAdjustmentEvent", () => {
  const event = buildDailyAdjustmentEvent({
    tenantId: "tenant-1",
    day: "2026-07-05",
    model: "kimi-k2.5",
    adjustmentUsd: 0.85,
    providerUsd: 0.97,
    recordedUsd: 0.12,
    dayEndMs: Date.parse("2026-07-06T00:00:00.000Z"),
  });

  it("uses a stable request id so re-runs are no-ops under the unique key", () => {
    expect(event.request_id).toBe("backfill:2026-07-05:kimi-k2.5");
    expect(event.event_type).toBe("llm");
  });

  it("is enforcement-exempt with approximate attribution (R11/KTD6)", () => {
    expect(event.enforcement_exempt).toBe(true);
    expect(event.metadata).toMatchObject({
      source: "backfill_daily_adjustment",
      approximate_attribution: true,
      provider_usd: 0.97,
      recorded_usd_before: 0.12,
    });
  });

  it("carries provider-log evidence and invocation-reconciled state", () => {
    expect(event.reconciliation_state).toBe("invocation-reconciled");
    expect(event.reconciliation_source).toBe("bedrock_invocation_log");
    expect(event.source_evidence_ref).toMatchObject({
      source_type: "bedrock_invocation_log",
      backfill: "daily_adjustment",
    });
  });

  it("lands inside the day it corrects", () => {
    expect((event.created_at as Date).toISOString()).toBe(
      "2026-07-05T23:59:59.999Z",
    );
  });
});
