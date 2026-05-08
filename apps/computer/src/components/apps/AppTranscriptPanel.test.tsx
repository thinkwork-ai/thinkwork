import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppTranscriptPanel } from "./AppTranscriptPanel";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(cleanup);

describe("AppTranscriptPanel", () => {
  it("shows artifact metadata and recipe steps", () => {
    const manifest = getFixtureDashboardManifestByArtifactId(
      "artifact-crm-pipeline-risk-fixture",
    );
    if (!manifest) throw new Error("missing fixture manifest");

    render(<AppTranscriptPanel manifest={manifest} />);

    expect(screen.getByText("Generated app")).toBeTruthy();
    expect(screen.getByText("Original request")).toBeTruthy();
    expect(screen.getAllByText("Source Query").length).toBeGreaterThan(0);
    expect(screen.getByText("Dashboard artifact saved")).toBeTruthy();
  });
});
