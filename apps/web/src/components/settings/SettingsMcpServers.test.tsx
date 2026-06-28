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
});

function textAppearsBefore(left: string, right: string): boolean {
  const leftElement = screen.getByText(left);
  const rightElement = screen.getByText(right);
  return Boolean(
    leftElement.compareDocumentPosition(rightElement) &
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}
