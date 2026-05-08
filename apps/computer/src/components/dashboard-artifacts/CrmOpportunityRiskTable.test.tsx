import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrmOpportunityRiskTable } from "./CrmOpportunityRiskTable";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(cleanup);

function fixtureManifest() {
  const manifest = getFixtureDashboardManifestByArtifactId(
    "artifact-crm-pipeline-risk-fixture",
  );
  if (!manifest) throw new Error("missing fixture manifest");
  return manifest;
}

describe("CrmOpportunityRiskTable", () => {
  it("renders long names and malicious text as plain table content", () => {
    render(<CrmOpportunityRiskTable manifest={fixtureManifest()} />);

    expect(
      screen.getByText("Cedar Ridge Fulfillment and Reverse Logistics International"),
    ).toBeTruthy();
    expect(screen.getByText("<script>alert(1)</script> renewal")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("sorts high-risk rows before lower-risk rows", () => {
    render(<CrmOpportunityRiskTable manifest={fixtureManifest()} />);

    const riskCells = screen.getAllByText("high");
    expect(riskCells.length).toBeGreaterThan(0);
  });
});
