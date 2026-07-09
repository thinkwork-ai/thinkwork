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
  pathname: "/settings/mcp-servers",
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
  tenantContext: {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1" as string | null,
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
  // The Internal tab reads analystInternalClusters via useQuery.
  useQuery: () => [mocks.clustersQuery, mocks.reexecuteClusters],
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
  mocks.pathname = "/settings/mcp-servers";
  mocks.provisionAnalyst.mockReset();
  mocks.registerDataSource.mockReset();
  mocks.registerInternal.mockReset();
  mocks.reexecuteClusters.mockReset();
  mocks.clustersQuery = {
    data: { analystInternalClusters: DEFAULT_CLUSTERS },
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
  };
  mocks.authUser = {
    email: "operator@example.com",
    sub: "cognito-sub-1",
    groups: [],
  };
});

afterEach(cleanup);

describe("SettingsMcpServers", () => {
  it("splits individual MCP servers from plugin-installed servers", async () => {
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
          managementSource: "managed_application",
          managedApplicationKey: "twenty-crm",
        },
        {
          id: "lastmile-tasks",
          name: "LastMile Tasks",
          slug: "lastmile-tasks",
          url: "https://api.thinkwork.test/mcp/tasks",
          enabled: true,
          authType: "tenant_api_key",
          status: "approved",
          managementSource: "plugin",
          managedApplicationKey: null,
        },
        {
          id: "lastmile-crm-plugin",
          name: "LastMile CRM",
          slug: "lastmile-crm-plugin",
          url: "https://api.thinkwork.test/mcp/lastmile",
          enabled: true,
          authType: "tenant_api_key",
          status: "approved",
          managementSource: "plugin",
          managedApplicationKey: null,
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
          managementSource: "plugin",
          managedApplicationKey: null,
        },
        {
          id: "manual-duplicate",
          name: "LastMile CRM",
          slug: "manual-lastmile-crm",
          url: "https://api.thinkwork.test/mcp/lastmile/",
          enabled: true,
          authType: "oauth",
          status: "approved",
          managementSource: "manual",
          managedApplicationKey: null,
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
    });
    mocks.listUserMcpServers.mockResolvedValue({
      servers: [{ id: "twenty", authStatus: "not_connected" }],
    });

    render(<SettingsMcpServers />);

    // The MCP Servers tab shows only manual, non-plugin, non-datasource rows.
    expect(await screen.findByText("Manual CRM")).toBeTruthy();
    expect(screen.queryByText("Twenty CRM")).toBeNull();
    expect(screen.queryByText("LastMile Tasks")).toBeNull();
    expect(screen.queryByText("From plugins")).toBeNull();
    // The manual duplicate of a plugin URL stays filtered out.
    expect(screen.queryByText("LastMile CRM")).toBeNull();
    expect(screen.queryByText("Rows per page")).toBeNull();
    expect(screen.queryByText(/Page\s+1\s+of/i)).toBeNull();
    // The inline Remove/System column is gone — removal lives in the detail view.
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();

    // Header carries the three-tab strip.
    const headerConfig = mocks.setHeader.mock.calls.at(-1)?.[0];
    expect(headerConfig?.title).toBe("MCP Servers");
    expect(headerConfig?.tabs).toEqual([
      { to: "/settings/mcp-servers", label: "MCP Servers" },
      { to: "/settings/mcp-servers/plugins", label: "Plugin MCPs" },
      { to: "/settings/mcp-servers/data-sources", label: "Datasource MCPs" },
    ]);

    // The Plugin MCPs tab shows the plugin-installed servers, sorted.
    cleanup();
    mocks.pathname = "/settings/mcp-servers/plugins";
    render(<SettingsMcpServers />);
    expect(await screen.findByText("Twenty CRM")).toBeTruthy();
    expect(screen.getAllByText("LastMile CRM")).toHaveLength(1);
    expect(screen.getAllByText("plugin")).toHaveLength(4);
    expect(screen.queryByText("Manual CRM")).toBeNull();
    expect(textAppearsBefore("LastMile CRM", "LastMile Tasks")).toBe(true);
    expect(textAppearsBefore("LastMile Tasks", "n8n workflow management")).toBe(
      true,
    );
    expect(textAppearsBefore("n8n workflow management", "Twenty CRM")).toBe(
      true,
    );
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
  });

  it("lists analyst connectors on the Datasource MCPs tab with cluster · database", async () => {
    mocks.listMcpServers.mockResolvedValue({
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
    });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    // Datasource rows are excluded from the MCP Servers tab...
    render(<SettingsMcpServers />);
    expect(await screen.findByText("Manual CRM")).toBeTruthy();
    expect(screen.queryByText("Analytics Demo")).toBeNull();
    expect(screen.queryByText("Postgres (dev)")).toBeNull();

    // ...and listed with cluster · database on the Datasource MCPs tab.
    cleanup();
    mocks.pathname = "/settings/mcp-servers/data-sources";
    render(<SettingsMcpServers />);
    expect(await screen.findByText("Analytics Demo")).toBeTruthy();
    expect(screen.getByText("Postgres (dev)")).toBeTruthy();
    expect(screen.queryByText("Manual CRM")).toBeNull();
    expect(screen.getByText("thinkwork-dev-db · analytics_demo")).toBeTruthy();
    expect(screen.getByText("workspace cluster · thinkwork")).toBeTruthy();
    // Each row carries its Internal/External badge.
    expect(screen.getAllByText("internal")).toHaveLength(2);
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
    clickHeaderAction("Register data source");
    // The single cluster auto-selects; pick an unregistered database.
    selectInternalDatabase("thinkwork_hindsight");

    // Name and slug are auto-suggested from the database name.
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Thinkwork Hindsight");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "thinkwork-hindsight",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Register data source" }),
    );

    await waitFor(() =>
      expect(mocks.registerInternal).toHaveBeenCalledWith({
        input: {
          clusterId: "thinkwork-dev-db",
          database: "thinkwork_hindsight",
          name: "Thinkwork Hindsight",
          slug: "thinkwork-hindsight",
        },
      }),
    );
    expect(await screen.findByText("Data source registered.")).toBeTruthy();
    expect(screen.getByText("thinkwork-hindsight")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("disables already-registered databases in the internal browser", async () => {
    mocks.listMcpServers.mockResolvedValue({ servers: [] });
    mocks.listUserMcpServers.mockResolvedValue({ servers: [] });

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
    clickHeaderAction("Register data source");

    const registered = screen.getByRole("option", {
      name: "analytics_demo (registered)",
    }) as HTMLOptionElement;
    expect(registered.disabled).toBe(true);
    const available = screen.getByRole("option", {
      name: "thinkwork_hindsight",
    }) as HTMLOptionElement;
    expect(available.disabled).toBe(false);
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
    clickHeaderAction("Register data source");
    selectInternalDatabase("thinkwork_hindsight");
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

    render(<SettingsMcpServers />);

    await screen.findByPlaceholderText("Search servers\u2026");
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
