import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-fetch", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    body = null;
  },
  apiFetch: vi.fn(),
}));

describe("mcp-api", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.unstubAllGlobals();
  });

  it("builds desktop MCP OAuth authorize URLs with return targets", async () => {
    const { buildMcpOAuthAuthorizeUrl } = await import("./mcp-api");

    const url = new URL(
      buildMcpOAuthAuthorizeUrl({
        mcpServerId: "server-1",
        userId: "user-1",
        tenantId: "tenant-1",
        returnTo: "http://localhost:5175/settings/mcp-servers/server-1",
      }),
    );

    expect(url.origin).toBe("https://api.example.com");
    expect(url.pathname).toBe("/api/skills/mcp-oauth/authorize");
    expect(url.searchParams.get("mcpServerId")).toBe("server-1");
    expect(url.searchParams.get("userId")).toBe("user-1");
    expect(url.searchParams.get("tenantId")).toBe("tenant-1");
    expect(url.searchParams.get("force")).toBe("true");
    expect(url.searchParams.get("returnTo")).toBe(
      "http://localhost:5175/settings/mcp-servers/server-1",
    );
  });

  it("can request MCP OAuth authorize URLs as JSON", async () => {
    const { buildMcpOAuthAuthorizeUrl } = await import("./mcp-api");

    const url = new URL(
      buildMcpOAuthAuthorizeUrl({
        mcpServerId: "server-1",
        userId: "user-1",
        tenantId: "tenant-1",
        returnTo: "http://localhost:5175/settings/mcp-servers/server-1",
        response: "json",
      }),
    );

    expect(url.searchParams.get("response")).toBe("json");
  });

  it("resolves MCP OAuth to the final authorization URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authorizeUrl: "https://auth.example.com/oauth2/authorize",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { resolveMcpOAuthAuthorizeUrl } = await import("./mcp-api");

    await expect(
      resolveMcpOAuthAuthorizeUrl({
        mcpServerId: "server-1",
        userId: "user-1",
        tenantId: "tenant-1",
        returnTo: "http://localhost:5175/settings/mcp-servers/server-1",
      }),
    ).resolves.toBe("https://auth.example.com/oauth2/authorize");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("response=json"),
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("falls back to direct authorize navigation when JSON resolution cannot be fetched", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { resolveMcpOAuthAuthorizeUrl } = await import("./mcp-api");

    const resolved = await resolveMcpOAuthAuthorizeUrl({
      mcpServerId: "server-1",
      userId: "user-1",
      tenantId: "tenant-1",
      returnTo: "http://localhost:5175/settings/mcp-servers/server-1",
    });

    const url = new URL(resolved);
    expect(url.origin).toBe("https://api.example.com");
    expect(url.pathname).toBe("/api/skills/mcp-oauth/authorize");
    expect(url.searchParams.get("response")).toBeNull();
  });

  it("lists runtime MCP tools through the proxy endpoint", async () => {
    const { apiFetch } = await import("@/lib/api-fetch");
    const { listRuntimeMcpTools } = await import("./mcp-api");
    vi.mocked(apiFetch).mockResolvedValue({ tools: [] });

    await listRuntimeMcpTools("agent-1");

    expect(apiFetch).toHaveBeenCalledWith("/api/mcp/tools/list", {
      method: "POST",
      body: JSON.stringify({ agentId: "agent-1" }),
      extraHeaders: {},
    });
  });

  it("calls bounded runtime MCP tools through the proxy endpoint", async () => {
    const { apiFetch } = await import("@/lib/api-fetch");
    const { callRuntimeMcpTool } = await import("./mcp-api");
    vi.mocked(apiFetch).mockResolvedValue({ content: [] });

    await callRuntimeMcpTool("agent-1", "twenty-crm", "get_tool_catalog", {
      limit: 25,
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/mcp/tools/call", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-1",
        server: "twenty-crm",
        tool: "get_tool_catalog",
        arguments: { limit: 25 },
      }),
      extraHeaders: {},
    });
  });
});
