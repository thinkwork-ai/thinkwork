import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemDisplayHeader } from "./WorkItemDisplayHeader";
import { DEFAULT_WORK_ITEM_SEARCH } from "./work-item-filters";

afterEach(() => {
  cleanup();
});

describe("WorkItemDisplayHeader", () => {
  it("exposes only List and Board modes with Work Item-native labels", () => {
    render(
      <WorkItemDisplayHeader
        state={DEFAULT_WORK_ITEM_SEARCH}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Display" }));

    expect(screen.getByRole("button", { name: "List" })).toBeTruthy();
    const boardButton = screen.getByRole("button", { name: "Board" });
    expect(boardButton).toBeTruthy();
    expect(boardButton.className).toContain("opacity-55");
    expect(screen.queryByText("Table")).toBeNull();
    expect(screen.queryByText("Map")).toBeNull();
    expect(screen.queryByText("Calendar")).toBeNull();
    expect(screen.queryByText("Organization")).toBeNull();
    expect(screen.queryByText("Estimate")).toBeNull();
    expect(screen.queryByText("Task type")).toBeNull();
  });

  it("switches to Board without mutating List configuration", () => {
    const onChange = vi.fn();
    render(
      <WorkItemDisplayHeader
        state={DEFAULT_WORK_ITEM_SEARCH}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_WORK_ITEM_SEARCH,
      view: "board",
    });
  });

  it("does not allow the last display property to be removed", () => {
    const onChange = vi.fn();
    render(
      <WorkItemDisplayHeader
        state={{
          ...DEFAULT_WORK_ITEM_SEARCH,
          list: {
            ...DEFAULT_WORK_ITEM_SEARCH.list,
            properties: ["priority"],
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
