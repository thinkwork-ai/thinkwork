import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrmSourceCoverage } from "./CrmSourceCoverage";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(cleanup);

function fixtureManifest() {
  const manifest = getFixtureDashboardManifestByArtifactId(
    "artifact-crm-pipeline-risk-fixture",
  );
  if (!manifest) throw new Error("missing fixture manifest");
  return manifest;
}

describe("CrmSourceCoverage", () => {
  it("shows successful and partial source states without hiding warnings", () => {
    render(<CrmSourceCoverage manifest={fixtureManifest()} />);

    expect(screen.getByText("crm")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
    expect(screen.getByText("calendar")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getAllByText("success").length).toBeGreaterThan(0);
    expect(screen.getByText("partial")).toBeTruthy();
    expect(
      screen.getByText(/Two account news searches timed out/i),
    ).toBeTruthy();
  });
});
