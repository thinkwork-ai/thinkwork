import { describe, expect, it } from "vitest";
import fixture from "./crm-pipeline-risk-dashboard.json";
import {
  parseDashboardManifestV1,
  type DashboardManifestV1,
} from "../../../../../packages/api/src/lib/dashboard-artifacts/manifest";

describe("CRM pipeline risk dashboard fixture", () => {
  it("validates against the dashboard manifest contract", () => {
    const manifest = parseDashboardManifestV1(fixture);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.dashboardKind).toBe("pipeline_risk");
    expect(manifest.tables[0]?.rows).toHaveLength(12);
    expect(manifest.sources.some((source) => source.status === "partial")).toBe(
      true,
    );
  });

  it("preserves script-looking opportunity names as plain strings", () => {
    const manifest = parseDashboardManifestV1(fixture);
    const row = opportunityRows(manifest).find((candidate) =>
      String(candidate.opportunity).includes("<script>"),
    );

    expect(row?.opportunity).toBe("<script>alert(1)</script> renewal");
  });

  it("includes long account names for responsive table coverage", () => {
    const manifest = parseDashboardManifestV1(fixture);
    const row = opportunityRows(manifest).find(
      (candidate) => String(candidate.account).length > 48,
    );

    expect(row?.account).toContain("Reverse Logistics International");
  });
});

function opportunityRows(manifest: DashboardManifestV1) {
  return manifest.tables.find((table) => table.id === "opportunities")?.rows ?? [];
}
