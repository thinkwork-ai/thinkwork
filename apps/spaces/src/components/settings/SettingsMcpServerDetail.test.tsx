import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setHeader: vi.fn(),
  listMcpServers: vi.fn(),
  listUserMcpServers: vi.fn(),
  deleteMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  clearUserMcpToken: vi.fn(),
  buildMcpOAuthAuthorizeUrl: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ serverId: "server-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1",
  }),
}));

vi.mock("@/lib/mcp-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-api")>();
  return {
    ...actual,
    listMcpServers: mocks.listMcpServers,
    listUserMcpServers: mocks.listUserMcpServers,
    deleteMcpServer: mocks.deleteMcpServer,
    setMcpServerEnabled: mocks.setMcpServerEnabled,
    clearUserMcpToken: mocks.clearUserMcpToken,
    buildMcpOAuthAuthorizeUrl: mocks.buildMcpOAuthAuthorizeUrl,
  };
});

import { SettingsMcpServerDetail } from "./SettingsMcpServerDetail";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.setHeader.mockReset();
  mocks.listMcpServers.mockReset();
  mocks.listUserMcpServers.mockReset();
  mocks.deleteMcpServer.mockReset();
  mocks.setMcpServerEnabled.mockReset();
  mocks.clearUserMcpToken.mockReset();
  mocks.buildMcpOAuthAuthorizeUrl.mockReset();
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
      screen.getByText(/Use CRM settings to park or destroy/i),
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
