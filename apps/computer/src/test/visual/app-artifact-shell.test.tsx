import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { crmDashboardVisualFixtures } from "./crm-dashboard.fixture";
import PipelineRiskApplet from "@/test/fixtures/crm-pipeline-risk-applet/source";

afterEach(cleanup);

describe("app artifact visual contract", () => {
  it("renders a single bounded app canvas without horizontal page scroll", () => {
    render(
      <AppArtifactSplitShell>
        <div>App canvas body</div>
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
      <PipelineRiskApplet
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

  it("keeps the dashboard focused on the primary analysis without recipe chrome", () => {
    render(
      <PipelineRiskApplet refreshData={crmDashboardVisualFixtures.failedCrm} />,
    );

    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Opportunity risk")).toBeTruthy();
    expect(screen.queryByText(/refresh recipe/i)).toBeNull();
    expect(screen.queryByText(/source coverage/i)).toBeNull();
    expect(screen.queryByText(/^evidence$/i)).toBeNull();
  });
});
