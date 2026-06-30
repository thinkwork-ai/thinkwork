import { describe, expect, it } from "vitest";
import {
  isCurrentPassedSkillTrustReport,
  SKILL_TRUST_PIPELINE_VERSION,
} from "./runtime-gate.js";

function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: "account-health-review",
    content_sha: "sha-current",
    trust_report: {
      status: "passed",
      spec: { status: "passed" },
      scanner: { status: "completed" },
      evidence: {
        skillCard: "starter_generated",
        evalDataset: "starter_generated",
        benchmark: "starter_generated",
        signature: "verified",
      },
    },
    trust_report_content_sha: "sha-current",
    trust_report_pipeline_version: SKILL_TRUST_PIPELINE_VERSION,
    ...overrides,
  };
}

describe("isCurrentPassedSkillTrustReport", () => {
  it("allows a passed trust report for the current content and pipeline version", () => {
    expect(isCurrentPassedSkillTrustReport(row())).toBe(true);
  });

  it("allows approved-unverified signature evidence as runtime-trusted operator approval", () => {
    expect(
      isCurrentPassedSkillTrustReport(
        row({
          trust_report: {
            status: "passed",
            spec: { status: "passed" },
            scanner: { status: "completed" },
            evidence: {
              skillCard: "present",
              evalDataset: "present",
              benchmark: "present",
              signature: "approved_unverified",
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("allows approved-unverified signed skills even when release evidence is incomplete", () => {
    expect(
      isCurrentPassedSkillTrustReport(
        row({
          trust_report: {
            status: "passed",
            spec: { status: "passed" },
            scanner: { status: "completed" },
            evidence: {
              skillCard: "missing",
              evalDataset: "missing",
              benchmark: "missing",
              signature: "approved_unverified",
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("fails closed for missing, stale, old-version, and non-passed reports", () => {
    expect(isCurrentPassedSkillTrustReport(row({ trust_report: null }))).toBe(
      false,
    );
    expect(
      isCurrentPassedSkillTrustReport(
        row({ trust_report_content_sha: "sha-old" }),
      ),
    ).toBe(false);
    expect(
      isCurrentPassedSkillTrustReport(
        row({ trust_report_pipeline_version: "old-pipeline" }),
      ),
    ).toBe(false);
    expect(
      isCurrentPassedSkillTrustReport(
        row({ trust_report: { status: "review" } }),
      ),
    ).toBe(false);
    expect(
      isCurrentPassedSkillTrustReport(
        row({
          trust_report: {
            status: "passed",
            spec: { status: "passed" },
            scanner: { status: "completed" },
            evidence: {
              skillCard: "starter_generated",
              evalDataset: "starter_generated",
              benchmark: "starter_generated",
              signature: "missing",
            },
          },
        }),
      ),
    ).toBe(false);
  });
});
