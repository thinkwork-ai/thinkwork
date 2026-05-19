import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingChecklistPanel } from "./OnboardingChecklistPanel";

afterEach(cleanup);

describe("OnboardingChecklistPanel", () => {
  it("renders progress, source context, sync health, and task owners", () => {
    render(
      <OnboardingChecklistPanel
        sourceContext={{
          companyName: "Acme Inc",
          opportunityId: "OPP-1",
          salesRep: "Jordan",
          missingFields: ["documents"],
        }}
        tasks={[
          {
            id: "task-1",
            title: "Run credit report",
            required: true,
            assigneeDisplay: "Finance",
            status: "COMPLETED",
            syncStatus: "SYNCED",
          },
          {
            id: "task-2",
            title: "Collect sales tax exemption",
            required: true,
            roleKey: "accounting",
            status: "TODO",
            syncStatus: "PENDING",
          },
        ]}
      />,
    );

    expect(screen.getByText("1/2 required complete")).toBeTruthy();
    expect(screen.getByText("Acme Inc")).toBeTruthy();
    expect(screen.getByText("Missing: documents")).toBeTruthy();
    expect(screen.getByText("Run credit report")).toBeTruthy();
    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getByText("Sync pending")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Archive" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("requires explicit confirmation before archiving a complete Thread", async () => {
    const onArchive = vi.fn();
    render(
      <OnboardingChecklistPanel
        onArchive={onArchive}
        tasks={[
          {
            id: "task-1",
            title: "Run credit report",
            required: true,
            status: "COMPLETED",
            syncStatus: "SYNCED",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Archive this Thread?")).toBeTruthy();
    expect(onArchive).not.toHaveBeenCalled();
  });
});
