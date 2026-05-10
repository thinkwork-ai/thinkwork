import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppArtifactSplitShell } from "./AppArtifactSplitShell";

afterEach(cleanup);

describe("AppArtifactSplitShell", () => {
  it("renders app content as a single canvas without provenance split view", () => {
    render(
      <AppArtifactSplitShell title="CRM app">
        <div>App body</div>
      </AppArtifactSplitShell>,
    );

    expect(screen.getByTestId("app-artifact-split-shell").className).toContain(
      "h-svh",
    );
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector('[data-generated-app-artifact]'),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
    expect(screen.queryByText("Made with ThinkWork Computer")).toBeNull();
    expect(screen.queryByText("New thread")).toBeNull();
    expect(screen.queryByLabelText("Computer provenance")).toBeNull();
    expect(screen.getByText("App body")).toBeTruthy();
  });
});
