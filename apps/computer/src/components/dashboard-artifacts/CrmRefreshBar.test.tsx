import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmRefreshBar, refreshStateFromTask } from "./CrmRefreshBar";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

afterEach(() => {
  cleanup();
});

function fixtureManifest() {
  const manifest = getFixtureDashboardManifestByArtifactId(
    "artifact-crm-pipeline-risk-fixture",
  );
  if (!manifest) throw new Error("missing fixture manifest");
  return manifest;
}

describe("CrmRefreshBar", () => {
  it("starts a deterministic refresh through the backend mutation", async () => {
    const onRefresh = vi.fn().mockResolvedValue({
      id: "task-1",
      status: "PENDING",
    });
    render(
      <CrmRefreshBar
        manifest={fixtureManifest()}
        canRefresh
        onRefresh={onRefresh}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(refreshButton);

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refreshing" }).hasAttribute("disabled")).toBe(
      true,
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("keeps reinterpretation separate from deterministic refresh", () => {
    render(
      <CrmRefreshBar
        manifest={fixtureManifest()}
        initialState="partial"
        canRefresh
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Partial success")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Ask Computer" }).getAttribute("href"),
    ).toBe("/computer?artifact=artifact-crm-pipeline-risk-fixture");
    expect(screen.getByText(/does not reinterpret the business question/i)).toBeTruthy();
  });

  it("maps Computer task states onto refresh states", () => {
    expect(refreshStateFromTask({ id: "task-1", status: "PENDING" })).toBe(
      "queued",
    );
    expect(refreshStateFromTask({ id: "task-1", status: "RUNNING" })).toBe(
      "running",
    );
    expect(refreshStateFromTask({ id: "task-1", status: "COMPLETED" })).toBe(
      "succeeded",
    );
    expect(refreshStateFromTask({ id: "task-1", status: "FAILED" })).toBe(
      "failed",
    );
  });
});
