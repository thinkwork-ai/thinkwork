import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { CrmPipelineRiskApp } from "@/components/dashboard-artifacts/CrmPipelineRiskApp";
import { crmDashboardVisualFixtures } from "./crm-dashboard.fixture";

afterEach(cleanup);

describe("app artifact visual contract", () => {
  it("keeps split-view panels bounded with independent canvas scrolling", () => {
    render(<AppArtifactSplitShell manifest={crmDashboardVisualFixtures.base} />);

    expect(screen.getByTestId("app-artifact-split-shell").className).toContain(
      "h-svh",
    );
    expect(screen.getByTestId("app-artifact-panels").className).toContain(
      "lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]",
    );
    expect(screen.getByTestId("app-canvas-panel").className).toContain(
      "overflow-auto",
    );
  });

  it("uses stable chart dimensions and safe table truncation for dense fixtures", () => {
    render(<CrmPipelineRiskApp manifest={crmDashboardVisualFixtures.denseProducts} />);

    expect(screen.getByTestId("stage-exposure-chart").className).toContain("h-64");
    expect(screen.getByTestId("product-exposure-chart").className).toContain(
      "h-64",
    );
    expect(screen.getByText("Cedar Ridge Fulfillment and Reverse Logistics International").className).toContain(
      "truncate",
    );
    expect(screen.getByText("<script>alert(1)</script> renewal")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("keeps partial and failed source coverage visible beside usable charts", () => {
    render(<CrmPipelineRiskApp manifest={crmDashboardVisualFixtures.failedCrm} />);

    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText(/prior dashboard snapshot remains visible/i)).toBeTruthy();
    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Opportunity risk")).toBeTruthy();
  });
});
