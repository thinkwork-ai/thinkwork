import * as React from "react";
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
  provisionAnalyst: vi.fn(),
  registerDataSource: vi.fn(),
  registerInternal: vi.fn(),
  reexecuteClusters: vi.fn(),
  listMcpServers: vi.fn(),
  listUserMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  // The analystInternalClusters query result the Internal tab renders.
  clustersQuery: { data: undefined, fetching: false, error: undefined } as {
    data: unknown;
    fetching: boolean;
    error: { message: string } | undefined;
  },
  // THINK-283: the analystInternalSchemas query result (per database).
  schemasQuery: { data: undefined, fetching: false, error: undefined } as {
    data: unknown;
    fetching: boolean;
    error: { message: string } | undefined;
  },
  reexecuteSchemas: vi.fn(),
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

vi.mock("urql", () => ({
  // Three mutations share this dialog; route each mock by operation name so the
  // built-in (provisionAnalystConnector), external (registerAnalystDataSource),
  // and internal (registerInternalAnalystDataSource) paths can be asserted
  // independently.
  useMutation: (document: {
    definitions?: { name?: { value?: string } }[];
  }) => {
    const opName = document?.definitions?.[0]?.name?.value;
    if (opName === "SettingsRegisterAnalystDataSource") {
      return [{ fetching: false }, mocks.registerDataSource];
    }
    if (opName === "SettingsRegisterInternalAnalystDataSource") {
      return [{ fetching: false }, mocks.registerInternal];
    }
    return [{ fetching: false }, mocks.provisionAnalyst];
  },
  // The Internal tab reads analystInternalClusters and (THINK-283)
  // analystInternalSchemas via useQuery — route by operation name.
  useQuery: (args: {
    query?: { definitions?: { name?: { value?: string } }[] };
  }) => {
    const opName = args?.query?.definitions?.[0]?.name?.value;
    if (opName === "SettingsAnalystInternalSchemas") {
      return [mocks.schemasQuery, mocks.reexecuteSchemas];
    }
    return [mocks.clustersQuery, mocks.reexecuteClusters];
  },
}));

// Render the @thinkwork/ui Select as a native <select> keyed by aria-label so
// the cluster/database pickers are driveable in jsdom (Radix Select's pointer
// capture doesn't work here). Everything else stays the real component.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@thinkwork/ui")>();
  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
      "aria-label": ariaLabel,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
      value: string;
      "aria-label"?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {children}
      </select>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      children,
      value,
      disabled,
    }: {
      children: React.ReactNode;
      value: string;
      disabled?: boolean;
    }) => (
      <option value={value} disabled={disabled}>
        {children}
      </option>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

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

// THINK-285: the Data Sources tab path — the old redirect stub is a live
// component route now.
const DATA_SOURCES_PATH = "/settings/mcp-servers/data-sources";

// Default internal-cluster enumeration: one cluster with the workspace
// database, an unregistered candidate, and an already-registered source.
const DEFAULT_CLUSTERS = [
  {
    clusterId: "thinkwork-dev-db",
    endpoint: "thinkwork-dev-db.cluster-x.us-east-1.rds.amazonaws.com",
    port: 5432,
    databases: [
      { name: "thinkwork", alreadyRegistered: true },
      { name: "thinkwork_hindsight", alreadyRegistered: false },
      { name: "analytics_demo", alreadyRegistered: true },
    ],
  },
];

// Drive the Internal tab's database picker (cluster auto-selects when single).
function selectInternalDatabase(name: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Database" }), {
    target: { value: name },
  });
}

// THINK-283: default schema enumeration — an empty public (explained, not
// hidden), a rich candidate, and an exact already-registered schema.
const DEFAULT_SCHEMAS = [
  { name: "public", eligibleTableCount: 0, alreadyRegistered: false },
  { name: "raw_jde", eligibleTableCount: 12, alreadyRegistered: false },
  { name: "platform", eligibleTableCount: 3, alreadyRegistered: true },
];

function selectInternalSchema(name: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), {
    target: { value: name },
  });
}

// The dialog-opening actions live in the page header (TooltipIconButtons
// passed to usePageHeaderActions) — render the latest captured action node
// and click the named icon button.
function clickHeaderAction(name: "Register data source" | "New MCP Server") {
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
  mocks.provisionAnalyst.mockReset();
  mocks.registerDataSource.mockReset();
  mocks.registerInternal.mockReset();
  mocks.reexecuteClusters.mockReset();
  mocks.clustersQuery = {
    data: { analystInternalClusters: DEFAULT_CLUSTERS },
    fetching: false,
    error: undefined,
  };
  mocks.reexecuteSchemas.mockReset();
  mocks.schemasQuery = {
    data: { analystInternalSchemas: DEFAULT_SCHEMAS },
    fetching: false,
    error: undefined,
  };
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
      { to: "/settings/mcp-servers/data-sources", label: "Data Sources" },
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

  it("lists analyst connectors on the Data Sources tab with cluster · database", async () => {
    mocks.listMcpServers.mockResolvedValue(DATA_SOURCE_SERVERS);
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.pathname = DATA_SOURCES_PATH;

    // AE1 (THINK-285): the old /data-sources bookmark renders the datasource
    // table — Source / Instance / Database columns — without tenant rows.
    render(<SettingsMcpServers />);
    expect(await screen.findByText("Analytics Demo")).toBeTruthy();
    expect(screen.getByText("Postgres (dev)")).toBeTruthy();
    expect(screen.queryByText("Manual CRM")).toBeNull();
    expect(screen.queryByText("Datasource MCPs")).toBeNull();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Instance")).toBeTruthy();
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("thinkwork-dev-db")).toBeTruthy();
    expect(screen.getByText("workspace cluster")).toBeTruthy();
    expect(screen.getByText("analytics_demo")).toBeTruthy();
    expect(screen.getByText("thinkwork")).toBeTruthy();
    // Each row carries its Internal/External badge.
    expect(screen.getAllByText("internal")).toHaveLength(2);

    // Row click opens the server detail route.
    fireEvent.click(screen.getByText("Analytics Demo"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/mcp-servers/$serverId",
      params: { serverId: "analytics-demo" },
    });
  });

  it("keeps datasource rows and the Datasource MCPs section off the servers tab", async () => {
    mocks.listMcpServers.mockResolvedValue(DATA_SOURCE_SERVERS);
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    render(<SettingsMcpServers />);
    expect(await screen.findByText("Manual CRM")).toBeTruthy();
    expect(screen.queryByText("Datasource MCPs")).toBeNull();
    expect(screen.queryByText("Analytics Demo")).toBeNull();
    expect(screen.queryByText("Postgres (dev)")).toBeNull();
  });

  it("renders the Data Sources empty state when none are registered", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.pathname = DATA_SOURCES_PATH;

    render(<SettingsMcpServers />);
    expect(await screen.findByText("No data sources registered.")).toBeTruthy();
    expect(screen.queryByText("No MCP servers configured.")).toBeNull();
  });

  it("shows a loading pane, then surfaces fetch errors, on the Data Sources tab", async () => {
    mocks.pathname = DATA_SOURCES_PATH;
    // While the server list is unresolved the pane renders its loading state,
    // never a premature empty message.
    mocks.listMcpServers.mockReturnValue(new Promise(() => {}));
    mocks.listUserMcpServers.mockReturnValue(new Promise(() => {}));
    render(<SettingsMcpServers />);
    expect(screen.queryByText("No data sources registered.")).toBeNull();
    cleanup();

    mocks.listMcpServers.mockRejectedValue(new Error("catalog unreachable"));
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    render(<SettingsMcpServers />);
    expect(await screen.findByText("catalog unreachable")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search data sources…")).toBeNull();
  });

  it("filters Data Sources independently of the servers tab's search", async () => {
    mocks.listMcpServers.mockResolvedValue(DATA_SOURCE_SERVERS);
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    const { rerender } = render(<SettingsMcpServers />);
    expect(await screen.findByText("Manual CRM")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search servers…"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.queryByText("Manual CRM")).toBeNull();

    // Switching to the Data Sources tab: the servers-tab filter does not
    // leak — datasource rows render and the tab's own search box is empty.
    mocks.pathname = DATA_SOURCES_PATH;
    rerender(<SettingsMcpServers />);
    expect(await screen.findByText("Analytics Demo")).toBeTruthy();
    const dataSourceSearch = screen.getByPlaceholderText(
      "Search data sources…",
    ) as HTMLInputElement;
    expect(dataSourceSearch.value).toBe("");
    fireEvent.change(dataSourceSearch, { target: { value: "postgres" } });
    expect(screen.queryByText("Analytics Demo")).toBeNull();
    expect(screen.getByText("Postgres (dev)")).toBeTruthy();
  });

  it("shows only the tab-owning header action on each tab", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    // Servers tab: New MCP Server only (AE2, THINK-285).
    render(<SettingsMcpServers />);
    await screen.findByPlaceholderText("Search servers…");
    const serversAction = render(
      <>{mocks.setHeader.mock.calls.at(-1)?.[0]?.action}</>,
    );
    expect(
      serversAction.getByRole("button", { name: "New MCP Server" }),
    ).toBeTruthy();
    expect(
      serversAction.queryByRole("button", { name: "Register data source" }),
    ).toBeNull();
    cleanup();

    // Data Sources tab: Register data source only.
    mocks.setHeader.mockClear();
    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);
    await screen.findByPlaceholderText("Search data sources…");
    const dataSourcesAction = render(
      <>{mocks.setHeader.mock.calls.at(-1)?.[0]?.action}</>,
    );
    expect(
      dataSourcesAction.getByRole("button", { name: "Register data source" }),
    ).toBeTruthy();
    expect(
      dataSourcesAction.queryByRole("button", { name: "New MCP Server" }),
    ).toBeNull();
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

  it("registers the analyst data source and renders the outcomes", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.provisionAnalyst.mockResolvedValue({
      data: {
        provisionAnalystConnector: {
          connectorId: "conn-analyst",
          connectorOutcome: "created",
          brokerSecretOutcome: "created",
          rdsIamCredentialOutcome: "created",
          profileRefreshed: true,
          foldersWritten: 4,
          foldersSkipped: 1,
        },
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    expect(
      await screen.findByRole("heading", { name: "Register data source" }),
    ).toBeTruthy();

    // The built-in provisioning form renders after picking the workspace
    // database in the Internal browser.
    selectInternalDatabase("thinkwork");
    fireEvent.click(
      await screen.findByRole("button", { name: "Provision data source" }),
    );

    await waitFor(() =>
      expect(mocks.provisionAnalyst).toHaveBeenCalledWith({
        reApprove: false,
        rotateToken: false,
      }),
    );
    expect(await screen.findByText("Data source provisioned.")).toBeTruthy();
    expect(screen.getByText("4 written · 1 skipped")).toBeTruthy();
    expect(screen.getByText("conn-analyst")).toBeTruthy();
  });

  it("keeps rotate/re-approve controls out of the create dialog", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    expect(
      await screen.findByRole("heading", { name: "Register data source" }),
    ).toBeTruthy();

    // The re-approve / rotate-broker-token affordances live on the connector
    // detail surface, never in the create dialog.
    expect(screen.queryByRole("checkbox", { name: "Re-approve" })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Rotate broker token" }),
    ).toBeNull();
  });

  it("labels the primary action Refresh when the built-in connector exists", async () => {
    mocks.listMcpServers.mockResolvedValue({
      servers: [
        {
          id: "postgres-dev",
          name: "Analyst Postgres",
          slug: "postgres-dev",
          url: "https://api.thinkwork.test/mcp/analyst",
          enabled: true,
          authType: "service_credential",
          status: "approved",
          managementSource: "manual",
          managedApplicationKey: null,
        },
      ],
    });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    selectInternalDatabase("thinkwork");

    expect(
      await screen.findByRole("button", { name: "Refresh data source" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Provision data source" }),
    ).toBeNull();
  });

  it("rejects a bad slug pattern and the reserved postgres-dev slug", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    const externalTab = screen.getByRole("tab", {
      name: "External",
    });
    fireEvent.mouseDown(externalTab);
    fireEvent.click(externalTab);

    const register = await screen.findByRole("button", {
      name: "Register data source",
    });

    // Fill everything but the slug so only slug validity gates submission.
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Sales Postgres" },
    });
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "db.internal.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Database"), {
      target: { value: "sales" },
    });
    fireEvent.change(screen.getByLabelText("DB user"), {
      target: { value: "analyst_reader" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "s3cret" },
    });

    // A bad pattern (uppercase / leading hyphen) is rejected inline.
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "-Bad_Slug" },
    });
    expect(
      screen.getByText(/lowercase letters, digits and hyphens/i),
    ).toBeTruthy();
    expect((register as HTMLButtonElement).disabled).toBe(true);

    // The reserved built-in slug is rejected with its own message.
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "postgres-dev" },
    });
    expect(
      screen.getByText(/reserved for the built-in data source/i),
    ).toBeTruthy();
    expect((register as HTMLButtonElement).disabled).toBe(true);

    // A valid slug clears the error and enables submission.
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "sales-postgres" },
    });
    expect((register as HTMLButtonElement).disabled).toBe(false);

    expect(mocks.registerDataSource).not.toHaveBeenCalled();
  });

  it("registers an external Postgres data source and renders the summary", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.registerDataSource.mockResolvedValue({
      data: {
        registerAnalystDataSource: {
          serverId: "srv-sales",
          slug: "sales-postgres",
          tables: 12,
          foldersWritten: 3,
          foldersSkipped: 1,
        },
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    const externalTab = screen.getByRole("tab", {
      name: "External",
    });
    fireEvent.mouseDown(externalTab);
    fireEvent.click(externalTab);

    // Display name auto-suggests the kebab-case slug.
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "Sales Postgres" },
    });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "sales-postgres",
    );

    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "db.internal.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Database"), {
      target: { value: "sales" },
    });
    // THINK-283: the schema field begins prefilled with "public" and can be
    // replaced with an explicit schema.
    expect((screen.getByLabelText("Schema") as HTMLInputElement).value).toBe(
      "public",
    );
    fireEvent.change(screen.getByLabelText("Schema"), {
      target: { value: "sales_mart" },
    });
    fireEvent.change(screen.getByLabelText("DB user"), {
      target: { value: "analyst_reader" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "s3cret" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Register data source" }),
    );

    await waitFor(() =>
      expect(mocks.registerDataSource).toHaveBeenCalledWith({
        input: {
          name: "Sales Postgres",
          slug: "sales-postgres",
          host: "db.internal.example.com",
          port: 5432,
          database: "sales",
          schema: "sales_mart",
          dbUser: "analyst_reader",
          password: "s3cret",
          tls: "VERIFY_FULL",
        },
      }),
    );

    expect(await screen.findByText("Data source registered.")).toBeTruthy();
    expect(screen.getByText("sales-postgres")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("3 written · 1 skipped")).toBeTruthy();
    expect(screen.getByText("srv-sales")).toBeTruthy();
    // The list refetches after a successful registration (initial load + reload).
    expect(mocks.listMcpServers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the external registration error verbatim", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.registerDataSource.mockResolvedValue({
      error: {
        message:
          "[GraphQL] role analyst_reader has non-SELECT grants; provision a read-only role.",
        graphQLErrors: [
          {
            message:
              "role analyst_reader has non-SELECT grants; provision a read-only role.",
          },
        ],
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    const externalTab = screen.getByRole("tab", {
      name: "External",
    });
    fireEvent.mouseDown(externalTab);
    fireEvent.click(externalTab);

    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "Sales Postgres" },
    });
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "db.internal.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Database"), {
      target: { value: "sales" },
    });
    fireEvent.change(screen.getByLabelText("DB user"), {
      target: { value: "analyst_reader" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "s3cret" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Register data source" }),
    );

    expect(
      await screen.findByText(
        "role analyst_reader has non-SELECT grants; provision a read-only role.",
      ),
    ).toBeTruthy();
  });

  it("surfaces the GraphQL error message verbatim on provision failure", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.provisionAnalyst.mockResolvedValue({
      error: {
        message: "[GraphQL] Only tenant admins can register data sources.",
        graphQLErrors: [
          { message: "Only tenant admins can register data sources." },
        ],
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    selectInternalDatabase("thinkwork");
    fireEvent.click(
      await screen.findByRole("button", { name: "Provision data source" }),
    );

    expect(
      await screen.findByText("Only tenant admins can register data sources."),
    ).toBeTruthy();
  });

  it("registers an internal database through the cluster browser", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.registerInternal.mockResolvedValue({
      data: {
        registerInternalAnalystDataSource: {
          serverId: "srv-hindsight",
          slug: "thinkwork-hindsight",
          tables: 9,
          foldersWritten: 2,
          foldersSkipped: 0,
        },
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    // The single cluster auto-selects; pick an unregistered database.
    selectInternalDatabase("thinkwork_hindsight");
    // THINK-283: with an empty `public`, an explicit schema choice is
    // required before the form can submit.
    selectInternalSchema("raw_jde");

    // Name and slug are auto-suggested from the database AND the schema —
    // two schemas of the same database must not collide on the default slug.
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Thinkwork Hindsight Raw Jde");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "thinkwork-hindsight-raw-jde",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Register data source" }),
    );

    await waitFor(() =>
      expect(mocks.registerInternal).toHaveBeenCalledWith({
        input: {
          clusterId: "thinkwork-dev-db",
          database: "thinkwork_hindsight",
          schema: "raw_jde",
          name: "Thinkwork Hindsight Raw Jde",
          slug: "thinkwork-hindsight-raw-jde",
        },
      }),
    );
    expect(await screen.findByText("Data source registered.")).toBeTruthy();
    expect(screen.getByText("thinkwork-hindsight")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("THINK-283: schema-level coverage \u2014 registered/empty schemas disabled, database stays selectable", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");

    // A database with a registered source is still selectable (coverage is
    // per-schema now), just labeled.
    const withSource = screen.getByRole("option", {
      name: "analytics_demo (has registered source)",
    }) as HTMLOptionElement;
    expect(withSource.disabled).toBe(false);

    selectInternalDatabase("thinkwork_hindsight");

    // Empty public is EXPLAINED (visible, disabled) \u2014 never silently hidden.
    const emptyPublic = screen.getByRole("option", {
      name: "public (no eligible tables)",
    }) as HTMLOptionElement;
    expect(emptyPublic.disabled).toBe(true);
    // The exact registered schema is disabled; a different schema in the
    // same database remains selectable with its live table count.
    const registered = screen.getByRole("option", {
      name: "platform (registered)",
    }) as HTMLOptionElement;
    expect(registered.disabled).toBe(true);
    const candidate = screen.getByRole("option", {
      name: "raw_jde \u2014 12 tables",
    }) as HTMLOptionElement;
    expect(candidate.disabled).toBe(false);
  });

  it("THINK-283: changing the database clears a stale schema; loading/error states cannot submit", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);
    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");

    selectInternalDatabase("thinkwork_hindsight");
    selectInternalSchema("raw_jde");
    // Switching databases resets the schema selection: with everything else
    // auto-filled, submit stays disabled until a NEW schema is chosen (a
    // stale schema surviving the switch would have left it enabled).
    selectInternalDatabase("analytics_demo");
    const submit = screen.getByRole("button", {
      name: "Register data source",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    selectInternalSchema("raw_jde");
    expect(submit.disabled).toBe(false);

    // Loading and error schema states surface accessibly and block submit.
    mocks.schemasQuery = { data: undefined, fetching: true, error: undefined };
    selectInternalDatabase("thinkwork_hindsight");
    expect(await screen.findByRole("status")).toBeTruthy();

    mocks.schemasQuery = {
      data: undefined,
      fetching: false,
      error: { message: "[GraphQL] catalog unreachable" },
    };
    selectInternalDatabase("analytics_demo");
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.reexecuteSchemas).toHaveBeenCalled();
  });

  it("surfaces an internal registration error verbatim", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.registerInternal.mockResolvedValue({
      error: {
        message: '[GraphQL] slug "taken" is already in use for this tenant.',
        graphQLErrors: [
          { message: 'slug "taken" is already in use for this tenant.' },
        ],
      },
    });

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");
    selectInternalDatabase("thinkwork_hindsight");
    selectInternalSchema("raw_jde");
    fireEvent.click(
      screen.getByRole("button", { name: "Register data source" }),
    );

    expect(
      await screen.findByText(
        'slug "taken" is already in use for this tenant.',
      ),
    ).toBeTruthy();
  });

  it("shows loading and error states for the cluster enumeration", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });
    mocks.clustersQuery = {
      data: undefined,
      fetching: false,
      error: { message: "[GraphQL] RDS describe failed" },
    };

    mocks.pathname = DATA_SOURCES_PATH;
    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search data sources\u2026");
    clickHeaderAction("Register data source");

    expect(
      await screen.findByText(/Failed to load clusters: RDS describe failed/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.reexecuteClusters).toHaveBeenCalled();
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
