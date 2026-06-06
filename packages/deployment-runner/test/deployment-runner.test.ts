import { describe, expect, it } from "vitest";
import { buildApplySummary } from "../src/apply";
import { buildPlanSummary } from "../src/plan";
import { stablePlanDigest } from "../src/shared";

const digest = "a".repeat(64);
const planDigest = "b".repeat(64);

describe("deployment runner contract", () => {
  it("builds a deterministic plan summary with destructive impact", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant/one",
        jobId: "job-1",
        appKey: "twenty",
        operation: "DESTROY",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
      },
    });

    expect(summary.dataImpact.destructive).toBe(true);
    expect(summary.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(summary.evidence).toEqual({
      bucket: "evidence-bucket",
      prefix: "tenant_one/twenty/job-1/plan",
    });
  });

  it("requires apply jobs to carry matching plan and manifest digests", () => {
    const summary = buildApplySummary({
      evidenceBucket: "evidence-bucket",
      verifiedManifestDigest: digest,
      input: {
        phase: "apply",
        tenantId: "tenant-1",
        jobId: "job-1",
        appKey: "cognee",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        planDigest,
      },
    });

    expect(summary.planDigest).toBe(planDigest);
    expect(summary.dataImpact.destructive).toBe(false);
  });

  it("fails closed on manifest digest mismatch", () => {
    expect(() =>
      buildApplySummary({
        evidenceBucket: "evidence-bucket",
        verifiedManifestDigest: "c".repeat(64),
        input: {
          phase: "apply",
          tenantId: "tenant-1",
          jobId: "job-1",
          appKey: "cognee",
          operation: "ENABLE",
          releaseVersion: "1.2.3",
          manifestDigest: digest,
          desiredConfigVersion: "v1",
          planDigest,
        },
      }),
    ).toThrow(/manifest digest/i);
  });

  it("uses canonical JSON for stable plan digests", () => {
    expect(stablePlanDigest({ b: 2, a: 1 })).toBe(
      stablePlanDigest({ a: 1, b: 2 }),
    );
  });
});
