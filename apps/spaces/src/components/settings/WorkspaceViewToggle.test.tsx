import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceViewToggle } from "./WorkspaceViewToggle";
import { SettingsPageTitle } from "./SettingsContent";

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));

afterEach(cleanup);

describe("WorkspaceViewToggle", () => {
  it("shows the files (destination) icon and unpressed state on the info view", () => {
    render(<WorkspaceViewToggle showingWorkspace={false} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Open workspace files" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the info (destination) icon and pressed state on the workspace view", () => {
    render(<WorkspaceViewToggle showingWorkspace={true} onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Show information" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onToggle once when clicked", () => {
    const onToggle = vi.fn();
    render(<WorkspaceViewToggle showingWorkspace={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPageTitle badge", () => {
  it("renders a badge beside the title when provided", () => {
    render(<SettingsPageTitle title="Eric Odom" badge={<span>Active</span>} />);
    expect(screen.getByText("Eric Odom")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("renders without a badge for existing callers", () => {
    render(<SettingsPageTitle title="Agent" />);
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
  });
});
