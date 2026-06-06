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
});
