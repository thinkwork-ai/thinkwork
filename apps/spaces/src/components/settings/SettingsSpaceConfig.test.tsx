import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, editorSpy, headerActions } = vi.hoisted(() => ({
  queryDocs: {
    SettingsSpaceQuery: Symbol("space"),
    SettingsUpdateSpaceMutation: Symbol("updateSpace"),
  },
  editorSpy: vi.fn(),
  headerActions: { current: null as Record<string, unknown> | null },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ spaceId: "space-1" }),
}));

vi.mock("urql", () => ({
  useQuery: () => [
    {
      data: {
        space: {
          id: "space-1",
          tenantId: "tenant-1",
          name: "Customer",
          description: "",
          accessMode: "PUBLIC",
          status: "active",
        },
      },
      fetching: false,
    },
    vi.fn(),
  ],
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (actions: Record<string, unknown> | null) => {
    headerActions.current = actions;
  },
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/lib/workspace-files-api", () => ({
  spacesWorkspaceFilesClient: {},
}));
vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: (props: Record<string, unknown>) => {
    editorSpy(props);
    return <div data-testid="workspace-editor" />;
  },
}));

import { SettingsSpaceConfig } from "./SettingsSpaceConfig";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  headerActions.current = null;
});

describe("SettingsSpaceConfig workspace guidance", () => {
  it("labels the Space source workspace when the file view is open", () => {
    render(<SettingsSpaceConfig />);

    act(() => {
      const action = headerActions.current?.action as {
        props?: { onToggle?: () => void };
      };
      action.props?.onToggle?.();
    });

    expect(screen.getByTestId("workspace-editor")).toBeTruthy();
    const props = editorSpy.mock.calls[0][0];
    expect(props.target).toEqual({ spaceId: "space-1" });
    expect(props.defaultOpenFile).toBe("CONTEXT.md");
    expect(props.title).toBe("Space source workspace");
    expect(props.description).toContain("only inside this Space");
    expect(props.description).toContain("Space/");
  });
});
