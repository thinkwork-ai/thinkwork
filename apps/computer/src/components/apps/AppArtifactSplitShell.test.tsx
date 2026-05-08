import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "./AppArtifactSplitShell";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(cleanup);

describe("AppArtifactSplitShell", () => {
  it("renders a fixture app with provenance and canvas panels", () => {
    const manifest = getFixtureDashboardManifestByArtifactId(
      "artifact-crm-pipeline-risk-fixture",
    );
    if (!manifest) throw new Error("missing fixture manifest");

    render(<AppArtifactSplitShell manifest={manifest} />);

    expect(
      screen.getAllByText("LastMile CRM pipeline risk").length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("Computer provenance")).toBeTruthy();
    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getAllByText("Source coverage").length).toBeGreaterThan(0);
  });
});
