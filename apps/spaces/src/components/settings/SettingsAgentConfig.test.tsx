import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, editorSpy, headerActions } = vi.hoisted(() => ({
  queryDocs: {
    SettingsModelCatalogQuery: Symbol("modelCatalog"),
    SettingsTenantAgentQuery: Symbol("tenantAgent"),
    SettingsUpdateTenantAgentMutation: Symbol("updateTenantAgent"),
  },
  editorSpy: vi.fn(),
  headerActions: { current: null as Record<string, unknown> | null },
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: symbol }) => {
    if (query === queryDocs.SettingsTenantAgentQuery) {
      return [
        {
          data: {
            agent: {
              id: "agent-1",
              tenantId: "tenant-1",
              runtime: "FLUE",
              model: "anthropic.claude",
            },
          },
          fetching: false,
        },
      ];
    }
    return [{ data: { modelCatalog: [] }, fetching: false }];
  },
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
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

import { SettingsAgentConfig } from "./SettingsAgentConfig";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  headerActions.current = null;
});

describe("SettingsAgentConfig workspace guidance", () => {
  it("labels the agent source workspace when the file view is open", () => {
    render(<SettingsAgentConfig />);

    act(() => {
      const action = headerActions.current?.action as {
        props?: { onToggle?: () => void };
      };
      action.props?.onToggle?.();
    });

    expect(screen.getByTestId("workspace-editor")).toBeTruthy();
    const props = editorSpy.mock.calls[0][0];
    expect(props.target).toEqual({ agentId: "agent-1" });
    expect(props.defaultOpenFile).toBe("AGENTS.md");
    expect(props.title).toBe("Agent source workspace");
    expect(props.description).toContain("tenant-wide runtime base");
    expect(props.description).toContain("/workspace root");
  });
});
