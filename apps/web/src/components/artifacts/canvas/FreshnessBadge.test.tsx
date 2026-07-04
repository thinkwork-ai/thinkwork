import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FreshnessBadge } from "./FreshnessBadge";
import type { FreshnessDisplayState } from "./binding-display";

afterEach(cleanup);

describe("FreshnessBadge", () => {
  it.each<[FreshnessDisplayState, string]>([
    ["GOOD", "Live"],
    ["STALE", "Stale"],
    ["BAD", "Failed"],
    ["SCHEMA_STALE", "Needs rebuild"],
    ["REFRESHING", "Refreshing"],
  ])("renders %s with label %s", (state, label) => {
    render(<FreshnessBadge state={state} />);
    const badge = screen.getByTestId("freshness-badge");
    expect(badge.textContent).toContain(label);
    expect(badge.getAttribute("data-state")).toBe(state);
  });

  it("shows a spinner only in the REFRESHING state", () => {
    const { rerender } = render(<FreshnessBadge state="GOOD" />);
    expect(screen.queryByTestId("freshness-badge-spinner")).toBeNull();
    rerender(<FreshnessBadge state="REFRESHING" />);
    expect(screen.getByTestId("freshness-badge-spinner")).toBeTruthy();
  });
});
