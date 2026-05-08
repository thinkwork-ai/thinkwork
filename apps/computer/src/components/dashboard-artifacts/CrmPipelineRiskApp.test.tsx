import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrmPipelineRiskApp } from "./CrmPipelineRiskApp";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(cleanup);

function fixtureManifest() {
  const manifest = getFixtureDashboardManifestByArtifactId(
    "artifact-crm-pipeline-risk-fixture",
  );
  if (!manifest) throw new Error("missing fixture manifest");
  return manifest;
}

describe("CrmPipelineRiskApp", () => {
  it("renders KPI, chart, source, evidence, and refresh sections", () => {
    render(<CrmPipelineRiskApp manifest={fixtureManifest()} />);

    expect(screen.getByText("Open pipeline")).toBeTruthy();
    expect(screen.getByText("High-risk exposure")).toBeTruthy();
    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Product-line exposure")).toBeTruthy();
    expect(screen.getByText("Opportunity risk")).toBeTruthy();
    expect(screen.getByText("Evidence")).toBeTruthy();
    expect(screen.getAllByText("Source coverage").length).toBeGreaterThan(0);
    expect(screen.getByText("Refresh recipe")).toBeTruthy();
  });

  it("keeps the dashboard read-only and separates refresh from reinterpretation", () => {
    render(<CrmPipelineRiskApp manifest={fixtureManifest()} />);

    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask Computer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update crm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create calendar/i })).toBeNull();
  });
});
