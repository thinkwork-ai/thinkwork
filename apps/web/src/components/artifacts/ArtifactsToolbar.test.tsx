import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactsToolbar } from "./ArtifactsToolbar";

afterEach(cleanup);

describe("ArtifactsToolbar", () => {
  it("renders the collapsed search affordance and no drafts toggle", () => {
    render(<ArtifactsToolbar search="" onSearchChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Search artifacts" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("artifacts-include-drafts")).toBeNull();
  });

  it("expands search and forwards typed values", () => {
    const onSearchChange = vi.fn();
    render(<ArtifactsToolbar search="" onSearchChange={onSearchChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Search artifacts" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search artifacts" }),
      {
        target: { value: "report" },
      },
    );
    expect(onSearchChange).toHaveBeenCalledWith("report");
  });

  it("hides the operator user filter for non-operators", () => {
    render(<ArtifactsToolbar search="" onSearchChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  });

  it("shows the operator user token filter when enabled", () => {
    render(
      <ArtifactsToolbar
        search=""
        onSearchChange={vi.fn()}
        showUserFilter
        onUserIdFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });
});
