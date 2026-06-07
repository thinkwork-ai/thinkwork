import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingChecklistPanel } from "./OnboardingChecklistPanel";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("OnboardingChecklistPanel", () => {
  it("renders native progress, source context, and task owners without external sync copy", () => {
    render(
      <OnboardingChecklistPanel
        sourceContext={{
          companyName: "Acme Inc",
          opportunityId: "OPP-1",
          salesRep: "Jordan",
          taxExempt: true,
          creditTermsRequested: false,
          missingFields: ["documents"],
        }}
        tasks={[
          {
            id: "task-1",
            provider: "THINKWORK",
            title: "Run credit report",
            required: true,
            assigneeDisplay: "Finance",
            status: "COMPLETED",
            syncStatus: "SYNCED",
          },
          {
            id: "task-2",
            provider: "THINKWORK",
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
    expect(screen.getAllByText("ThinkWork checklist").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("LastMile")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Complete Thread" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("requires explicit confirmation before completing a complete Thread", async () => {
    const onCompleteThread = vi.fn();
    render(
      <OnboardingChecklistPanel
        onCompleteThread={onCompleteThread}
        tasks={[
          {
            id: "task-1",
            provider: "THINKWORK",
            title: "Run credit report",
            required: true,
            status: "COMPLETED",
            syncStatus: "SYNCED",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete Thread" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Complete this Thread?")).toBeTruthy();
    expect(onCompleteThread).not.toHaveBeenCalled();
  });

  it("updates native checklist row status through the status control", async () => {
    const onUpdateTask = vi.fn();
    render(
      <OnboardingChecklistPanel
        onUpdateTask={onUpdateTask}
        tasks={[
          {
            id: "task-1",
            provider: "THINKWORK",
            title: "Run credit report",
            required: true,
            status: "TODO",
            syncStatus: "SYNCED",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Checklist status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Completed" }));

    expect(onUpdateTask).toHaveBeenCalledWith("task-1", "COMPLETED");
  });
});
