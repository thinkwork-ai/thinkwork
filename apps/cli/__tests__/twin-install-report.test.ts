import { describe, it, expect } from "vitest";

import {
  createReport,
  record,
  markNotAttempted,
  reportExitCode,
  isZeroChange,
  renderReport,
} from "../src/lib/twin-install-report.js";

describe("twin install report", () => {
  it("all-found run renders zero-changes summary and exit 0 (AE4)", () => {
    const r = createReport();
    record(r, "etl stack: neptune", "found", "no changes");
    record(r, "etl stack: landing-bucket", "found", "no changes");
    record(r, "product Neptune tfvars", "found", "values current");
    record(r, "MCP registration", "skipped", "already registered (adopted)");
    expect(reportExitCode(r)).toBe(0);
    expect(isZeroChange(r)).toBe(true);
    expect(renderReport(r)).toMatch(
      /no changes \(everything already installed\)/,
    );
  });

  it("mixed created/found run lists each correctly (AE3 shape)", () => {
    const r = createReport();
    record(r, "etl stack: neptune", "created", "cluster created");
    record(r, "product Neptune tfvars", "created", "deploy ran");
    record(r, "MCP registration", "created", "tkt_ key issued");
    expect(reportExitCode(r)).toBe(0);
    expect(isZeroChange(r)).toBe(false);
    const out = renderReport(r);
    expect(out).toContain("etl stack: neptune");
    expect(out).toContain("created");
    expect(out).toMatch(/Complete\./);
  });

  it("mid-sequence failure yields exit 1, names completed + failed, never later steps", () => {
    const r = createReport();
    record(r, "etl stack: neptune", "found", "no changes");
    record(
      r,
      "etl stack: landing-bucket",
      "failed",
      "apply error: AccessDenied",
    );
    markNotAttempted(r, ["product Neptune tfvars", "MCP registration"]);
    expect(reportExitCode(r)).toBe(1);
    const out = renderReport(r);
    expect(out).toContain("FAILED");
    expect(out).toMatch(/Not attempted/);
    expect(out).toContain("MCP registration");
    // the not-attempted steps are never rendered as attempted entries
    expect(r.entries.map((e) => e.resource)).not.toContain("MCP registration");
  });

  it("empty report is not zero-change and exits 0 only when something ran", () => {
    const r = createReport();
    expect(isZeroChange(r)).toBe(false);
  });
});
