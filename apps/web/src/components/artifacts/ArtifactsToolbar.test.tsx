import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactsToolbar } from "./ArtifactsToolbar";

afterEach(cleanup);

describe("ArtifactsToolbar include-drafts toggle", () => {
  it("is hidden when no onIncludeDraftsChange handler is supplied", () => {
    render(<ArtifactsToolbar search="" onSearchChange={vi.fn()} />);
    expect(screen.queryByTestId("artifacts-include-drafts")).toBeNull();
  });

  it("defaults off (saved-only) and toggles includeDrafts on change", () => {
    const onIncludeDraftsChange = vi.fn();
    render(
      <ArtifactsToolbar
        search=""
        onSearchChange={vi.fn()}
        includeDrafts={false}
        onIncludeDraftsChange={onIncludeDraftsChange}
      />,
    );
    const toggle = screen.getByTestId("artifacts-include-drafts-switch");
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(toggle);
    expect(onIncludeDraftsChange).toHaveBeenCalledWith(true);
  });
});
