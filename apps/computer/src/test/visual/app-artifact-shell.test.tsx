import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { crmDashboardVisualFixtures } from "./crm-dashboard.fixture";
import CrmPipelineRiskApplet from "@/test/fixtures/crm-pipeline-risk-applet/source";

afterEach(cleanup);

describe("app artifact visual contract", () => {
  it("renders a single bounded applet canvas without horizontal page scroll", () => {
    render(
      <AppArtifactSplitShell
        title={crmDashboardVisualFixtures.base.snapshot.title}
      >
        <div>Applet canvas body</div>
      </AppArtifactSplitShell>,
    );

    expect(screen.getByTestId("app-artifact-split-shell").className).toContain(
      "h-svh",
    );
    expect(screen.getByTestId("app-artifact-panels").className).not.toContain(
      "grid-cols",
    );
    expect(screen.getByTestId("app-canvas-panel").className).toContain(
      "overflow-x-hidden",
    );
    expect(screen.getByTestId("app-canvas-panel").className).toContain(
      "overflow-y-auto",
    );
    expect(screen.queryByLabelText("Computer provenance")).toBeNull();
  });

  it("uses stable chart dimensions and safe table truncation for dense fixtures", () => {
    render(
      <CrmPipelineRiskApplet
        refreshData={crmDashboardVisualFixtures.denseProducts}
      />,
    );

    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Product-line exposure")).toBeTruthy();
    expect(
      screen.getByText(
        "Cedar Ridge Fulfillment and Reverse Logistics International",
      ).className,
    ).toContain("truncate");
    expect(screen.getByText("<script>alert(1)</script> renewal")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("keeps partial and failed source coverage visible beside usable charts", () => {
    render(
      <CrmPipelineRiskApplet
        refreshData={crmDashboardVisualFixtures.failedCrm}
      />,
    );

    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/prior dashboard snapshot remains visible/i),
    ).toBeTruthy();
    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Opportunity risk")).toBeTruthy();
  });
});
