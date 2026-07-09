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
  provisionAnalyst: vi.fn(),
  registerDataSource: vi.fn(),
  listMcpServers: vi.fn(),
  listUserMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
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
  // Two mutations share this dialog; route each mock by operation name so the
  // built-in (provisionAnalystConnector) and external (registerAnalystDataSource)
  // paths can be asserted independently.
  useMutation: (document: {
    definitions?: { name?: { value?: string } }[];
  }) => {
    const opName = document?.definitions?.[0]?.name?.value;
    if (opName === "SettingsRegisterAnalystDataSource") {
      return [{ fetching: false }, mocks.registerDataSource];
    }
    return [{ fetching: false }, mocks.provisionAnalyst];
  },
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

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setHeader.mockReset();
  mocks.provisionAnalyst.mockReset();
  mocks.registerDataSource.mockReset();
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

    expect(await screen.findByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("LastMile CRM")).toBeTruthy();
    expect(screen.getByText("Manual CRM")).toBeTruthy();
    expect(screen.queryByText("Individual servers")).toBeNull();
    expect(screen.getByText("From plugins")).toBeTruthy();
    expect(screen.getAllByText("LastMile CRM")).toHaveLength(1);
    expect(screen.getAllByText("plugin")).toHaveLength(4);
    expect(textAppearsBefore("LastMile CRM", "LastMile Tasks")).toBe(true);
    expect(textAppearsBefore("LastMile Tasks", "n8n workflow management")).toBe(
      true,
    );
    expect(textAppearsBefore("n8n workflow management", "Twenty CRM")).toBe(
      true,
    );
    expect(textAppearsBefore("LastMile Tasks", "Twenty CRM")).toBe(true);
    expect(screen.queryByText("Rows per page")).toBeNull();
    expect(screen.queryByText(/Page\s+1\s+of/i)).toBeNull();
    // The inline Remove/System column is gone — removal lives in the detail view.
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.getByText("connected")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "+ New MCP Server" }));
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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    expect(await screen.findByText("Register data source")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Provision data source" }),
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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    expect(await screen.findByText("Register data source")).toBeTruthy();

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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );

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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    const externalTab = screen.getByRole("tab", {
      name: "External PostgreSQL",
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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    const externalTab = screen.getByRole("tab", {
      name: "External PostgreSQL",
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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    const externalTab = screen.getByRole("tab", {
      name: "External PostgreSQL",
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

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Register data source" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Provision data source" }),
    );

    expect(
      await screen.findByText("Only tenant admins can register data sources."),
    ).toBeTruthy();
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
