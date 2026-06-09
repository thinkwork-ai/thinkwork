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
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
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
});

afterEach(cleanup);

describe("SettingsMcpServers", () => {
  it("marks managed MCP servers and hides their manual remove action", async () => {
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
          id: "kestra",
          name: "Kestra",
          slug: "kestra-control",
          url: "https://api.thinkwork.test/mcp/kestra",
          enabled: true,
          authType: "tenant_api_key",
          status: "approved",
          managementSource: "managed_application",
          managedApplicationKey: "kestra",
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
    expect(screen.getByText("Kestra")).toBeTruthy();
    expect(screen.getAllByText("managed")).toHaveLength(2);
    // The inline Remove/System column is gone — removal lives in the detail view.
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.getByText("not connected")).toBeTruthy();
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
});
