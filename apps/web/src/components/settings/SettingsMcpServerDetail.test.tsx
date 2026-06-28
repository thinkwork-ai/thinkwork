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
  useQuery: vi.fn(),
  listMcpServers: vi.fn(),
  listUserMcpServers: vi.fn(),
  listRuntimeMcpTools: vi.fn(),
  callRuntimeMcpTool: vi.fn(),
  deleteMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  getMcpServiceCredentialStatus: vi.fn(),
  saveMcpServiceCredential: vi.fn(),
  clearUserMcpToken: vi.fn(),
  buildMcpOAuthAuthorizeUrl: vi.fn(),
  resolveMcpOAuthAuthorizeUrl: vi.fn(),
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
  useParams: () => ({ serverId: "server-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => mocks.tenantContext,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mocks.authUser,
  }),
}));

vi.mock("urql", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/lib/mcp-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-api")>();
  return {
    ...actual,
    listMcpServers: mocks.listMcpServers,
    listUserMcpServers: mocks.listUserMcpServers,
    listRuntimeMcpTools: mocks.listRuntimeMcpTools,
    callRuntimeMcpTool: mocks.callRuntimeMcpTool,
    deleteMcpServer: mocks.deleteMcpServer,
    setMcpServerEnabled: mocks.setMcpServerEnabled,
    getMcpServiceCredentialStatus: mocks.getMcpServiceCredentialStatus,
    saveMcpServiceCredential: mocks.saveMcpServiceCredential,
    clearUserMcpToken: mocks.clearUserMcpToken,
    buildMcpOAuthAuthorizeUrl: mocks.buildMcpOAuthAuthorizeUrl,
    resolveMcpOAuthAuthorizeUrl: mocks.resolveMcpOAuthAuthorizeUrl,
  };
});

import { SettingsMcpServerDetail } from "./SettingsMcpServerDetail";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setHeader.mockReset();
  mocks.useQuery.mockReset();
  mocks.listMcpServers.mockReset();
  mocks.listUserMcpServers.mockReset();
  mocks.listRuntimeMcpTools.mockReset();
  mocks.callRuntimeMcpTool.mockReset();
  mocks.deleteMcpServer.mockReset();
  mocks.setMcpServerEnabled.mockReset();
  mocks.getMcpServiceCredentialStatus.mockReset();
  mocks.saveMcpServiceCredential.mockReset();
  mocks.clearUserMcpToken.mockReset();
  mocks.buildMcpOAuthAuthorizeUrl.mockReset();
  mocks.resolveMcpOAuthAuthorizeUrl.mockReset();
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
  mocks.useQuery.mockReturnValue([{ data: { agent: { id: "agent-1" } } }]);
  mocks.listRuntimeMcpTools.mockResolvedValue({ tools: [] });
  mocks.callRuntimeMcpTool.mockResolvedValue({ content: [] });
  mocks.getMcpServiceCredentialStatus.mockResolvedValue({
    authType: "service_credential",
    credentialKind: "n8n-mcp-access-token",
    hasCredential: false,
    lastFour: null,
    secretRefConfigured: true,
    headerName: "Authorization",
    secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
  });
  mocks.saveMcpServiceCredential.mockResolvedValue({
    ok: true,
    lastFour: "9876",
    headerName: "Authorization",
    secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
  });
  mocks.buildMcpOAuthAuthorizeUrl.mockImplementation(
    ({ mcpServerId, userId, tenantId }: Record<string, string>) =>
      `https://api.example.test/api/skills/mcp-oauth/authorize?mcpServerId=${mcpServerId}&userId=${userId}&tenantId=${tenantId}`,
  );
  mocks.resolveMcpOAuthAuthorizeUrl.mockReturnValue(new Promise(() => {}));
  window.history.replaceState({}, "", "/settings/mcp-servers/server-1");
});

afterEach(() => {
  cleanup();
});

describe("SettingsMcpServerDetail", () => {
  it("shows per-user OAuth connection controls for MCP servers", async () => {
    mockServerState("active");

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("keeps OAuth authentication available while DB user id discovery is loading", async () => {
    mocks.tenantContext.userId = null;
    mockServerState("not_connected");

    render(<SettingsMcpServerDetail />);

    const button = await screen.findByRole("button", {
      name: /authenticate/i,
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.resolveMcpOAuthAuthorizeUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "cognito-sub-1",
          tenantId: "tenant-1",
          mcpServerId: "server-1",
        }),
      ),
    );
  });

  it("uses the Cognito subject fallback when refreshing per-user MCP status", async () => {
    mocks.tenantContext.userId = null;
    mockServerState("active", {
      name: "LastMile Dispatch",
      slug: "lastmile-dispatch",
      url: "https://mcp-dev.lastmile-tei.com/dispatch",
    });

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("LastMile Dispatch")).toBeTruthy();
    expect(mocks.listUserMcpServers).toHaveBeenCalledWith(
      "tenant-1",
      "cognito-sub-1",
    );
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("starts MCP OAuth through the resolved authorization URL flow", async () => {
    mockServerState("not_connected");

    render(<SettingsMcpServerDetail />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /authenticate/i,
      }),
    );

    expect(await screen.findByText("Opening authorization...")).toBeTruthy();
    expect(mocks.resolveMcpOAuthAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tenantId: "tenant-1",
        mcpServerId: "server-1",
      }),
    );
  });

  it("surfaces MCP OAuth startup failures", async () => {
    mocks.resolveMcpOAuthAuthorizeUrl.mockRejectedValueOnce(
      new Error("metadata unavailable"),
    );
    mockServerState("not_connected");

    render(<SettingsMcpServerDetail />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /authenticate/i,
      }),
    );

    expect(
      await screen.findByText(
        "Authentication failed to start: metadata unavailable",
      ),
    ).toBeTruthy();
  });

  it("keeps managed MCP servers authenticatable but not manually removable", async () => {
    mockServerState("active", {
      managementSource: "managed_application",
      managedApplicationKey: "twenty-crm",
    });

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("System-managed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove server/i })).toBeNull();
    expect(
      screen.getByText(
        /Use the managed application settings to park or destroy/i,
      ),
    ).toBeTruthy();
  });

  it("handles desktop OAuth callback success by refreshing state", async () => {
    mockServerState("not_connected");
    window.history.replaceState(
      {},
      "",
      "/settings/mcp-servers/server-1?mcpOAuth=success&mcpServerId=server-1",
    );

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("Authentication connected.")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.listMcpServers).toHaveBeenCalledTimes(2);
    });
    expect(window.location.search).toBe("");
  });

  it("imports Twenty catalog tools and filters them", async () => {
    mockServerState("active", {
      managementSource: "managed_application",
      managedApplicationKey: "twenty-crm",
      tools: [],
    });
    mocks.listUserMcpServers.mockResolvedValue({
      servers: [
        {
          id: "server-1",
          name: "Twenty CRM",
          slug: "twenty-crm",
          url: "https://crm.thinkwork.ai/mcp",
          enabled: true,
          authType: "oauth",
          authStatus: "active",
          tools: [],
          runtimeEnabled: true,
        },
      ],
    });
    mocks.listRuntimeMcpTools.mockResolvedValue({
      tools: [
        {
          name: "twenty-crm__get_tool_catalog",
          server: "twenty-crm",
          tool: "get_tool_catalog",
          description: "Return available tools",
        },
      ],
    });
    mocks.callRuntimeMcpTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            catalog: {
              DATABASE_CRUD: [
                {
                  name: "find_many_opportunities",
                  description: "List opportunity records.",
                },
                {
                  name: "find_many_companies",
                  description: "List company records.",
                },
              ],
            },
          }),
        },
      ],
    });

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("find_many_opportunities")).toBeTruthy();
    expect(screen.getByText("find_many_companies")).toBeTruthy();
    expect(mocks.callRuntimeMcpTool).toHaveBeenCalledWith(
      "agent-1",
      "twenty-crm",
      "get_tool_catalog",
    );

    fireEvent.change(screen.getByRole("textbox", { name: /search tools/i }), {
      target: { value: "opportunities" },
    });

    expect(screen.getByText("find_many_opportunities")).toBeTruthy();
    expect(screen.queryByText("find_many_companies")).toBeNull();
  });

  it("lets admins save a plugin service credential access token", async () => {
    mockServerState("not_connected", {
      name: "n8n workflow management",
      slug: "n8n--workflow-management",
      url: "https://n8n.thinkwork.ai/mcp-server/http",
      authType: "service_credential",
      managementSource: "plugin",
      managedApplicationKey: null,
    });

    render(<SettingsMcpServerDetail />);

    expect(await screen.findByText("n8n workflow management")).toBeTruthy();
    expect(screen.getByText("Plugin-managed")).toBeTruthy();
    expect(await screen.findByText("N8N_MCP_SERVICE_CREDENTIAL")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Service credential access token"), {
      target: { value: "n8n_mcp_token_saved9876" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save token/i }));

    await waitFor(() => {
      expect(mocks.saveMcpServiceCredential).toHaveBeenCalledWith(
        "thinkwork",
        "server-1",
        "n8n_mcp_token_saved9876",
      );
    });
    expect(await screen.findByText("Service credential saved.")).toBeTruthy();
  });
});

function mockServerState(
  authStatus: "active" | "not_connected" | "expired",
  overrides: Record<string, unknown> = {},
) {
  mocks.listMcpServers.mockResolvedValue({
    servers: [
      {
        id: "server-1",
        name: "Twenty CRM",
        slug: "twenty-crm",
        url: "https://crm.thinkwork.ai/mcp",
        enabled: true,
        authType: "oauth",
        status: "approved",
        tools: [{ name: "opportunities.list" }],
        ...overrides,
      },
    ],
  });
  mocks.listUserMcpServers.mockResolvedValue({
    servers: [
      {
        id: "server-1",
        name: "Twenty CRM",
        url: "https://crm.thinkwork.ai/mcp",
        enabled: true,
        authType: "oauth",
        authStatus,
        tools: [{ name: "opportunities.list" }],
      },
    ],
  });
}
