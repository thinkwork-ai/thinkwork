import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { editorSpy, tenant, agentQuery } = vi.hoisted(() => ({
  editorSpy: vi.fn(),
  tenant: {
    tenantId: "tenant-1" as string | null,
    isLoading: false,
  },
  agentQuery: {
    data: { agent: { id: "agent-1" } } as Record<string, unknown> | null,
    fetching: false,
    error: null as Error | null,
  },
}));

vi.mock("urql", () => ({
  useQuery: () => [agentQuery, vi.fn()],
}));
vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));
vi.mock("@/lib/settings-queries", () => ({
  SettingsTenantAgentQuery: Symbol("agent"),
}));
vi.mock("./ScopedWorkspaceEditor", () => ({
  ScopedWorkspaceEditor: (props: Record<string, unknown>) => {
    editorSpy(props);
    return <div data-testid="scoped-editor" />;
  },
}));

import { SettingsMainAgent } from "./SettingsMainAgent";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  tenant.tenantId = "tenant-1";
  tenant.isLoading = false;
  agentQuery.data = { agent: { id: "agent-1" } };
  agentQuery.fetching = false;
  agentQuery.error = null;
});

describe("SettingsMainAgent", () => {
  it("mounts the scoped editor on the agent source only, opening AGENTS.md", () => {
    render(<SettingsMainAgent />);
    const props = editorSpy.mock.calls.at(-1)![0];
    // Single agent target — the Main Agent tree never spans users/ or spaces.
    expect(props.target).toEqual({ agentId: "agent-1" });
    expect(props.pathPrefix).toBeUndefined();
    expect(props.defaultOpenFile).toBe("AGENTS.md");
    expect(props.targetKey).toBe("agent:agent-1");
  });

  it("opens a requested file for deep links (?file= passthrough)", () => {
    render(<SettingsMainAgent defaultOpenFile="agents/research.md" />);
    const props = editorSpy.mock.calls.at(-1)![0];
    expect(props.defaultOpenFile).toBe("agents/research.md");
  });

  it("does not publish a page header — the hosting Agents page owns it", () => {
    // Rendered as the workspace view of Settings → Agents; a header publication
    // here would clobber the Agents breadcrumb/title. PageHeaderContext is not
    // mocked, so an accidental usePageHeaderActions call would throw here.
    expect(() => render(<SettingsMainAgent />)).not.toThrow();
  });

  it("shows a loader while the agent resolves", () => {
    agentQuery.data = null;
    agentQuery.fetching = true;
    const { container } = render(<SettingsMainAgent />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("scoped-editor")).toBeNull();
  });

  it("shows an error state when the agent query fails", () => {
    agentQuery.data = null;
    agentQuery.error = new Error("boom");
    render(<SettingsMainAgent />);
    expect(
      screen.getByText(/Couldn't load the Main Agent workspace/),
    ).toBeTruthy();
    expect(screen.queryByTestId("scoped-editor")).toBeNull();
  });

  it("shows a terminal empty state when no agent exists", () => {
    agentQuery.data = { agent: null };
    render(<SettingsMainAgent />);
    expect(
      screen.getByText(/No Main Agent workspace is available/),
    ).toBeTruthy();
  });
});
