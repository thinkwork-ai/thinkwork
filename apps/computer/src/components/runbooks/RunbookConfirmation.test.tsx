import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunbookConfirmation } from "./RunbookConfirmation";

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

afterEach(cleanup);

describe("RunbookConfirmation", () => {
  it("renders approval details and calls confirm once", async () => {
    let resolveConfirm: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <RunbookConfirmation
        data={{
          mode: "approval",
          runbookRunId: "run-1",
          displayName: "Map Artifact",
          summary: "Build a supplier risk map.",
          expectedOutputs: ["Interactive map", "Evidence summary"],
          phaseSummary: ["Discover sources", "Produce artifact"],
          likelyTools: ["workspace search"],
        }}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Map Artifact")).toBeTruthy();
    expect(screen.getByText("Build a supplier risk map.")).toBeTruthy();
    expect(screen.getByText("Interactive map")).toBeTruthy();
    expect(screen.getByText("Discover sources")).toBeTruthy();
    expect(screen.getByText("workspace search")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /approving/i }));
    resolveConfirm();

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith("run-1");
  });

  it("keeps the card visible and shows a recoverable error on failure", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <RunbookConfirmation
        data={{
          mode: "approval",
          runbookRunId: "run-1",
          displayName: "CRM Dashboard",
          summary: "Build the dashboard.",
        }}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
    expect(screen.getByText("CRM Dashboard")).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
  });

  it("renders an already-approved runbook without decision actions", () => {
    render(
      <RunbookConfirmation
        data={{
          mode: "approval",
          runbookRunId: "run-1",
          displayName: "CRM Dashboard",
          summary: "Build the dashboard.",
          status: "QUEUED",
        }}
      />,
    );

    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });

  it("renders ambiguous candidates without approval actions", () => {
    render(
      <RunbookConfirmation
        data={{
          mode: "choice",
          candidates: [
            {
              runbookSlug: "crm-dashboard",
              displayName: "CRM Dashboard",
              description: "Sales and retention dashboard.",
            },
            {
              runbookSlug: "research-dashboard",
              displayName: "Research Dashboard",
              description: "Generic research dashboard.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Candidate runbooks")).toBeTruthy();
    expect(screen.getByText("CRM Dashboard")).toBeTruthy();
    expect(screen.getByText("Research Dashboard")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });
});
