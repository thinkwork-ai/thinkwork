import { describe, expect, it } from "vitest";
import { buildCatalogSkillTrustReport } from "./catalog-report.js";

const skillMd = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
allowed-tools:
  - crm_account_summary
---

# Account Health Review
`;

describe("buildCatalogSkillTrustReport", () => {
  it("summarizes a scanned catalog skill with release evidence", () => {
    const report = buildCatalogSkillTrustReport({
      slug: "account-health-review",
      now: new Date("2026-06-21T00:00:00Z"),
      files: [
        { path: "SKILL.md", content: Buffer.from(skillMd) },
        { path: "skill-card.md", content: Buffer.from("# Skill card\n") },
        { path: "evals/evals.json", content: Buffer.from("[]") },
        { path: "BENCHMARK.md", content: Buffer.from("# Benchmark\n") },
        { path: "skill.oms.sig", content: Buffer.from("sig") },
      ],
      scanner: {
        status: "completed",
        riskScore: 3,
        riskSeverity: "LOW",
        recommendation: "INSTALL",
      },
    });

    expect(report).toMatchObject({
      slug: "account-health-review",
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "passed",
      spec: {
        status: "passed",
        name: "account-health-review",
        allowedTools: ["crm_account_summary"],
      },
      scanner: {
        status: "completed",
        riskScore: 3,
      },
      evidence: {
        skillCard: "present",
        evalDataset: "present",
        benchmark: "present",
        signature: "present_unverified",
      },
    });
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks when SkillSpector reports high severity findings", () => {
    const report = buildCatalogSkillTrustReport({
      slug: "account-health-review",
      files: [{ path: "SKILL.md", content: Buffer.from(skillMd) }],
      scanner: { status: "completed", riskScore: 88 },
      scannerFindings: [
        {
          id: "SC001",
          severity: "high",
          category: "data_exfiltration",
          message: "Reads broad credentials.",
          path: "scripts/audit.py",
        },
      ],
    });

    expect(report.status).toBe("blocked");
    expect(report.severityCounts.high).toBe(1);
    expect(report.findings[0]).toMatchObject({
      id: "SC001",
      path: "scripts/audit.py",
    });
  });

  it("fails when SKILL.md frontmatter is invalid", () => {
    const report = buildCatalogSkillTrustReport({
      slug: "account-health-review",
      files: [
        {
          path: "SKILL.md",
          content: Buffer.from("---\nname: Wrong Name\n---\n# Body\n"),
        },
      ],
    });

    expect(report.status).toBe("failed");
    expect(report.spec.status).toBe("failed");
    expect(report.spec.errors.join("\n")).toContain("field 'name'");
  });
});
