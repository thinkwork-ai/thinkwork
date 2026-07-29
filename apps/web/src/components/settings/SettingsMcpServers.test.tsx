import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setHeader: vi.fn(),
  pathname: "/settings/mcp-servers/servers",
  listMcpServers: vi.fn(),
  listUserMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  tenantContext: {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1" as string | null,
    isOperator: true,
  },
  authUser: {
    email: "operator@example.com",
    sub: "cognito-sub-1",
    groups: [],
  } as { email: string; sub: string; groups: string[] } | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: mocks.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mocks.authUser,
  }),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => mocks.tenantContext,
}));

// The Connections tab has its own suite (SettingsConnections.test.tsx); stub
// it here so this file stays focused on the MCP server list.
vi.mock("@/components/settings/SettingsConnections", () => ({
  SettingsConnections: () => (
    <div data-testid="connections-pane">connections pane</div>
  ),
}));

vi.mock("@/lib/mcp-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-api")>();
  return {
    ...actual,
    listMcpServers: mocks.listMcpServers,
    listUserMcpServers: mocks.listUserMcpServers,
    createMcpServer: mocks.createMcpServer,
    setMcpServerEnabled: mocks.setMcpServerEnabled,
  };
});

import { SettingsMcpServers } from "./SettingsMcpServers";

// The dialog-opening actions live in the page header (TooltipIconButtons
// passed to usePageHeaderActions) — render the latest captured action node
// and click the named icon button.
function clickHeaderAction(name: "New MCP Server") {
  const action = mocks.setHeader.mock.calls.at(-1)?.[0]?.action;
  expect(action).toBeTruthy();
  const { getByRole, unmount } = render(<>{action}</>);
  fireEvent.click(getByRole("button", { name }));
  unmount();
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setHeader.mockReset();
  mocks.pathname = "/settings/mcp-servers/servers";
  mocks.listMcpServers.mockReset();
  mocks.listUserMcpServers.mockReset();
  mocks.createMcpServer.mockReset();
  mocks.setMcpServerEnabled.mockReset();
  mocks.tenantContext = {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1",
    isOperator: true,
  };
  mocks.authUser = {
    email: "operator@example.com",
    sub: "cognito-sub-1",
    groups: [],
  };
});

afterEach(cleanup);

describe("SettingsMcpServers", () => {
  it("renders every registered server in one table, sorted by name", async () => {
    // Provenance is gone: the plugin system is removed and migration 0279
    // moved its servers to `manual`, so there is no Type column and no
    // plugin-vs-manual URL dedup — two rows sharing a URL are two rows.
    mocks.listMcpServers.mockResolvedValue({
      servers: [
        {
          id: "twenty",
          name: "Twenty CRM",
          slug: "twenty-crm",
          url: "https://crm.thinkwork.ai/mcp",
          enabled: true,
          authType: "oauth",
          status: "approved",
          managementSource: "manual",
        },
        {
          id: "n8n",
          name: "n8n workflow management",
          slug: "n8n--workflow-management",
          url: "https://n8n.thinkwork.ai/mcp-server/http",
          enabled: true,
          authType: "service_credential",
          authStatus: "active",
          status: "approved",
          managementSource: "manual",
        },
        {
          id: "aardvark",
          name: "Aardvark Tools",
          slug: "aardvark-tools",
          url: "https://aardvark.example/mcp",
          enabled: true,
          authType: "none",
          status: "approved",
          managementSource: "manual",
        },
        {
          id: "zeta",
          name: "Zeta Ops",
          slug: "zeta-ops",
          url: "https://zeta.example/mcp",
          enabled: true,
          authType: "none",
          status: "approved",
          managementSource: "manual",
        },
      ],
    });
    mocks.listUserMcpServers.mockResolvedValue({
      servers: [{ id: "twenty", authStatus: "not_connected" }],
    });

    render(<SettingsMcpServers />);

    expect(await screen.findByText("Aardvark Tools")).toBeTruthy();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("n8n workflow management")).toBeTruthy();
    expect(screen.getByText("Zeta Ops")).toBeTruthy();

    // Twenty and n8n remain reachable as ordinary MCP servers — that was the
    // explicit requirement when the plugin system was retired.
    expect(screen.queryByText("Tenant servers")).toBeNull();
    expect(screen.queryByText("Plugin MCPs")).toBeNull();
    for (const label of ["Plugin", "Tenant", "plugin", "System"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();

    expect(textAppearsBefore("Aardvark Tools", "n8n workflow management")).toBe(
      true,
    );
    expect(textAppearsBefore("n8n workflow management", "Twenty CRM")).toBe(
      true,
    );
    expect(textAppearsBefore("Twenty CRM", "Zeta Ops")).toBe(true);
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();

    // No row is lifecycle-locked now that nothing is externally managed.
    for (const name of ["Toggle Twenty CRM", "Toggle Zeta Ops"]) {
      expect(
        (screen.getByRole("switch", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }

    const headerConfig = mocks.setHeader.mock.calls.at(-1)?.[0];
    expect(headerConfig?.title).toBe("Connectors");
    expect(headerConfig?.breadcrumbs).toEqual([{ label: "Connectors" }]);
    expect(headerConfig?.tabs).toEqual([
      { to: "/settings/mcp-servers", label: "Connections" },
      { to: "/settings/mcp-servers/servers", label: "MCP Servers" },
    ]);
  });

  it("renders the merged empty state when no servers are configured", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    render(<SettingsMcpServers />);

    expect(await screen.findByText("No MCP servers configured.")).toBeTruthy();
    expect(screen.queryByText("Tenant servers")).toBeNull();
    expect(screen.queryByText("Plugin MCPs")).toBeNull();
    expect(screen.queryByText("Datasource MCPs")).toBeNull();
  });

  it("renders the Connections pane on the section index without server actions", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.pathname = "/settings/mcp-servers";

    render(<SettingsMcpServers />);

    expect(await screen.findByTestId("connections-pane")).toBeTruthy();
    // No server table, no search box on the Connections tab.
    expect(screen.queryByPlaceholderText("Search servers…")).toBeNull();
    const headerConfig = mocks.setHeader.mock.calls.at(-1)?.[0];
    expect(headerConfig?.title).toBe("Connectors");
    // The New-server / Register actions belong to the MCP Servers and Data
    // Sources tabs respectively; the Connections tab has none.
    expect(headerConfig?.action).toBeUndefined();
  });

  it("filters the merged table through the search box and navigates on row click", async () => {
    mocks.listMcpServers.mockResolvedValue({
      servers: [
        {
          id: "manual",
          name: "Manual CRM",
          slug: "manual-crm",
          url: "https://manual.example/mcp",
          enabled: true,
          authType: "none",
          status: "approved",
          managementSource: "manual",
          managedApplicationKey: null,
        },
        {
          id: "twenty",
          name: "Twenty CRM",
          slug: "twenty-crm",
          url: "https://crm.thinkwork.ai/mcp",
          enabled: true,
          authType: "oauth",
          status: "approved",
          managementSource: "plugin",
          managedApplicationKey: null,
        },
      ],
    });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    render(<SettingsMcpServers />);
    expect(await screen.findByText("Manual CRM")).toBeTruthy();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search servers…"), {
      target: { value: "twenty" },
    });
    expect(screen.queryByText("Manual CRM")).toBeNull();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();

    // Clicking a row opens the server detail route.
    fireEvent.click(screen.getByText("Twenty CRM"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/mcp-servers/$serverId",
      params: { serverId: "twenty" },
    });
  });

  it("toggles a server's enabled switch from the merged list", async () => {
    mocks.listMcpServers.mockResolvedValue({
      servers: [
        {
          id: "manual",
          name: "Manual CRM",
          slug: "manual-crm",
          url: "https://manual.example/mcp",
          enabled: true,
          authType: "none",
          status: "approved",
          managementSource: "manual",
          managedApplicationKey: null,
        },
      ],
    });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.setMcpServerEnabled.mockResolvedValue({});

    render(<SettingsMcpServers />);
    const toggle = await screen.findByRole("switch", {
      name: "Toggle Manual CRM",
    });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.setMcpServerEnabled).toHaveBeenCalledWith(
        "thinkwork",
        "manual",
        false,
      ),
    );
  });

  // Shared fixture: two analyst datasource rows plus one plain tenant server.
  const DATA_SOURCE_SERVERS = {
    servers: [
      {
        id: "postgres-dev",
        name: "Postgres (dev)",
        slug: "postgres-dev",
        url: "https://api.thinkwork.test/mcp/analyst",
        enabled: true,
        authType: "service_credential",
        status: "approved",
        managementSource: "manual",
        managedApplicationKey: null,
        dataSource: { kind: "internal", host: null, database: "thinkwork" },
      },
      {
        id: "analytics-demo",
        name: "Analytics Demo",
        slug: "analytics-demo",
        url: "https://api.thinkwork.test/mcp/analyst/analytics-demo",
        enabled: true,
        authType: "service_credential",
        status: "approved",
        managementSource: "manual",
        managedApplicationKey: null,
        dataSource: {
          kind: "internal",
          host: "thinkwork-dev-db.cluster-x.us-east-1.rds.amazonaws.com",
          database: "analytics_demo",
        },
      },
      {
        id: "manual",
        name: "Manual CRM",
        slug: "manual-crm",
        url: "https://manual.example/mcp",
        enabled: true,
        authType: "none",
        status: "approved",
        managementSource: "manual",
        managedApplicationKey: null,
      },
    ],
  };

  it("shows the New MCP Server action only on the servers tab", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    render(<SettingsMcpServers />);
    await screen.findByPlaceholderText("Search servers…");
    const serversAction = render(
      <>{mocks.setHeader.mock.calls.at(-1)?.[0]?.action}</>,
    );
    expect(
      serversAction.getByRole("button", { name: "New MCP Server" }),
    ).toBeTruthy();
    cleanup();

    // The per-user Connections tab (section index) owns no create action.
    mocks.setHeader.mockClear();
    mocks.pathname = "/settings/mcp-servers";
    render(<SettingsMcpServers />);
    await screen.findByTestId("connections-pane");
    expect(mocks.setHeader.mock.calls.at(-1)?.[0]?.action).toBeUndefined();
  });

  it("adds a server through the New MCP Server dialog", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.createMcpServer.mockResolvedValue({
      id: "new-1",
      slug: "my-server",
      created: true,
    });

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers…");
    clickHeaderAction("New MCP Server");
    expect(await screen.findByText("New MCP server")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("My MCP server"), {
      target: { value: "My Server" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/mcp"), {
      target: { value: "https://my.example/mcp" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    await waitFor(() => {
      expect(mocks.createMcpServer).toHaveBeenCalledWith("thinkwork", {
        name: "My Server",
        url: "https://my.example/mcp",
        authType: "none",
      });
    });
  });

  it("uses the Cognito subject fallback when loading per-user MCP status", async () => {
    mocks.tenantContext.userId = null;
    mocks.listMcpServers.mockResolvedValue({
      servers: [
        {
          id: "dispatch",
          name: "LastMile Dispatch",
          slug: "lastmile-dispatch",
          url: "https://mcp-dev.lastmile-tei.com/dispatch",
          enabled: true,
          authType: "oauth",
          status: "approved",
          managementSource: "manual",
          managedApplicationKey: null,
        },
      ],
    });
    mocks.listUserMcpServers.mockResolvedValue({
      servers: [{ id: "dispatch", authStatus: "active" }],
    });

    render(<SettingsMcpServers />);

    expect(await screen.findByText("LastMile Dispatch")).toBeTruthy();
    expect(mocks.listUserMcpServers).toHaveBeenCalledWith(
      "tenant-1",
      "cognito-sub-1",
    );
    expect(screen.getByText("connected")).toBeTruthy();
  });
});

function textAppearsBefore(left: string, right: string): boolean {
  const leftElement = screen.getByText(left);
  const rightElement = screen.getByText(right);
  return Boolean(
    leftElement.compareDocumentPosition(rightElement) &
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}
