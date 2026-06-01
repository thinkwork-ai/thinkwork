import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsolidatedSourcesState } from "./useConsolidatedSources";

const { useConsolidatedSources, usePageHeaderActions, editorSpy } = vi.hoisted(
  () => ({
    useConsolidatedSources: vi.fn(),
    usePageHeaderActions: vi.fn(),
    editorSpy: vi.fn(),
  }),
);

vi.mock("./useConsolidatedSources", () => ({ useConsolidatedSources }));
vi.mock("@/context/PageHeaderContext", () => ({ usePageHeaderActions }));
vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: (props: Record<string, unknown>) => {
    editorSpy(props);
    return (
      <div
        data-testid="editor"
        data-readonly={String(props.readOnly)}
        data-targetkey={String(props.targetKey)}
      />
    );
  },
}));

import { WorkspaceSettingsView } from "./WorkspaceSettingsView";

const resolved: ConsolidatedSourcesState = {
  subTargets: {
    agentId: "agent-1",
    spaces: [{ id: "s-fin", name: "finance" }],
    userId: "u-1",
  },
  isAdmin: true,
  loading: false,
  error: null,
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceSettingsView", () => {
  it("shows a loader while sources resolve", () => {
    useConsolidatedSources.mockReturnValue({
      subTargets: null,
      isAdmin: false,
      loading: true,
      error: null,
    });
    const { container } = render(<WorkspaceSettingsView />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("shows an error state when enumeration fails", () => {
    useConsolidatedSources.mockReturnValue({
      subTargets: null,
      isAdmin: false,
      loading: false,
      error: new Error("boom"),
    });
    render(<WorkspaceSettingsView />);
    expect(screen.getByText(/Couldn't load the workspace/)).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("mounts the editor editable for an admin with the consolidated target", () => {
    useConsolidatedSources.mockReturnValue(resolved);
    render(<WorkspaceSettingsView />);
    expect(screen.getByTestId("editor").getAttribute("data-readonly")).toBe(
      "false",
    );
    const props = editorSpy.mock.calls[0][0];
    expect(props.target).toEqual(resolved.subTargets);
    expect(props.client).toBeTruthy();
    // targetKey is derived from the source ids so the editor resets when they change.
    expect(props.targetKey).toContain("agent-1");
    expect(props.targetKey).toContain("s-fin");
  });

  it("mounts the editor read-only for a non-admin", () => {
    useConsolidatedSources.mockReturnValue({ ...resolved, isAdmin: false });
    render(<WorkspaceSettingsView />);
    expect(screen.getByTestId("editor").getAttribute("data-readonly")).toBe(
      "true",
    );
  });
});
