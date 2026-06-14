// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupedListView } from "../src/index.js";

afterEach(() => cleanup());

describe("GroupedListView", () => {
  it("renders collapsible group headers with counts and row content", () => {
    render(
      <GroupedListView
        groups={[
          {
            id: "active",
            label: "Active",
            rows: [
              { id: "one", title: "Follow up" },
              { id: "two", title: "Draft report" },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    expect(screen.getByRole("button", { name: /active 2/i })).toBeTruthy();
    expect(screen.getByText("Follow up")).toBeTruthy();
    expect(screen.getByText("Draft report")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /active 2/i }));
    expect(screen.queryByText("Follow up")).toBeNull();
    expect(screen.queryByText("Draft report")).toBeNull();
  });

  it("renders a supplied empty state when there are no groups", () => {
    render(
      <GroupedListView
        groups={[]}
        getRowId={(row: { id: string; title: string }) => row.id}
        renderRow={(row: { id: string; title: string }) => row.title}
        emptyState={<span>No rows here</span>}
      />,
    );

    expect(screen.getByText("No rows here")).toBeTruthy();
  });

  it("renders the empty state when supplied groups contain no rows", () => {
    render(
      <GroupedListView
        groups={[
          { id: "active", label: "Active", rows: [] },
          { id: "disabled", label: "Disabled", rows: [] },
        ]}
        getRowId={(row: { id: string; title: string }) => row.id}
        renderRow={(row: { id: string; title: string }) => row.title}
        emptyState={<span>No filtered rows</span>}
      />,
    );

    expect(screen.getByText("No filtered rows")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /active/i })).toBeNull();
  });

  it("renders subgroup headers and aggregate counts", () => {
    render(
      <GroupedListView
        groups={[
          {
            id: "daily",
            label: "Daily",
            rows: [],
            subgroups: [
              {
                id: "active",
                label: "Active",
                rows: [{ id: "one", title: "Daily active" }],
              },
              {
                id: "disabled",
                label: "Disabled",
                rows: [{ id: "two", title: "Daily disabled" }],
              },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    expect(screen.getByRole("button", { name: /daily 2/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /active 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /disabled 1/i })).toBeTruthy();
  });

  it("keeps subgroup header counts aligned with parent group counts", () => {
    render(
      <GroupedListView
        groups={[
          {
            id: "daily",
            label: "Daily",
            rows: [],
            subgroups: [
              {
                id: "scheduled",
                label: "Scheduled",
                rows: [{ id: "one", title: "Daily scheduled" }],
              },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    const subgroupHeader = screen.getByRole("button", {
      name: /scheduled 1/i,
    });
    expect(subgroupHeader.className).toContain("px-3");
    expect(subgroupHeader.className).not.toContain("pl-6");
    expect(subgroupHeader.className).not.toContain("px-6");
  });

  it("collapses repeated subgroup ids independently per parent group", () => {
    render(
      <GroupedListView
        groups={[
          {
            id: "daily",
            label: "Daily",
            rows: [],
            subgroups: [
              {
                id: "active",
                label: "Active",
                rows: [{ id: "one", title: "Daily active" }],
              },
            ],
          },
          {
            id: "weekly",
            label: "Weekly",
            rows: [],
            subgroups: [
              {
                id: "active",
                label: "Active",
                rows: [{ id: "two", title: "Weekly active" }],
              },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    const activeHeaders = screen.getAllByRole("button", { name: /active 1/i });
    fireEvent.click(activeHeaders[0]);

    expect(screen.queryByText("Daily active")).toBeNull();
    expect(screen.getByText("Weekly active")).toBeTruthy();
  });

  it("resets collapsed state when the grouping structure changes", () => {
    const view = render(
      <GroupedListView
        groups={[
          {
            id: "active",
            label: "Active",
            rows: [{ id: "one", title: "Active row" }],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /active 1/i }));
    expect(screen.queryByText("Active row")).toBeNull();

    view.rerender(
      <GroupedListView
        groups={[
          {
            id: "active",
            label: "Active",
            rows: [],
            subgroups: [
              {
                id: "schedule",
                label: "Schedule",
                rows: [{ id: "two", title: "Schedule row" }],
              },
            ],
          },
        ]}
        getRowId={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    expect(screen.getByText("Schedule row")).toBeTruthy();
  });
});
