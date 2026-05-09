import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "./AppArtifactSplitShell";

afterEach(cleanup);

describe("AppArtifactSplitShell", () => {
  it("renders applet content as a single canvas without provenance split view", () => {
    render(
      <AppArtifactSplitShell title="Generated app">
        <div>Applet body</div>
      </AppArtifactSplitShell>,
    );

    expect(screen.getAllByText("Generated app").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Computer provenance")).toBeNull();
    expect(screen.getByText("Applet body")).toBeTruthy();
  });
});
