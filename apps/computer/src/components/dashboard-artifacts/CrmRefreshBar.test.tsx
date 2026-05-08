import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmRefreshBar } from "./CrmRefreshBar";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fixtureManifest() {
  const manifest = getFixtureDashboardManifestByArtifactId(
    "artifact-crm-pipeline-risk-fixture",
  );
  if (!manifest) throw new Error("missing fixture manifest");
  return manifest;
}

describe("CrmRefreshBar", () => {
  it("moves refresh through queued, running, and succeeded states", () => {
    vi.useFakeTimers();
    render(<CrmRefreshBar manifest={fixtureManifest()} />);

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(refreshButton);

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refreshing" }).hasAttribute("disabled")).toBe(
      true,
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText("Running")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps reinterpretation separate from deterministic refresh", () => {
    render(<CrmRefreshBar manifest={fixtureManifest()} initialState="partial" />);

    expect(screen.getByText("Partial success")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Ask Computer" }).getAttribute("href"),
    ).toBe("/computer?artifact=artifact-crm-pipeline-risk-fixture");
    expect(screen.getByText(/does not reinterpret the business question/i)).toBeTruthy();
  });
});
