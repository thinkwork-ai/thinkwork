import { apiFetch, ApiError } from "@/lib/api-fetch";

// Minimal MCP-servers client (same REST endpoints admin uses). Spaces Settings
// exposes list + enable/disable + remove; register/test/discover/OAuth stay
// admin-only for now.

export type McpApprovalStatus = "pending" | "approved" | "rejected" | string;

export type McpServer = {
  id: string;
  name: string;
  slug?: string;
  url: string;
  enabled: boolean;
  authType?: string;
  authStatus?: "active" | "not_connected" | "expired";
  status?: McpApprovalStatus;
  tools?: Array<{ name: string; description?: string }>;
  managementSource?: string | null;
  managedApplicationKey?: string | null;
};

const API_URL = import.meta.env.VITE_API_URL || "";

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: string;
    tenantSlug: string;
    extraHeaders?: Record<string, string>;
  },
): Promise<T> {
  const { tenantSlug, extraHeaders, ...rest } = options;
  try {
    return await apiFetch<T>(path, {
      ...rest,
      extraHeaders: {
        ...(tenantSlug ? { "x-tenant-slug": tenantSlug } : {}),
        ...(extraHeaders ?? {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
}

export function listMcpServers(
  tenantSlug: string,
): Promise<{ servers: McpServer[] }> {
  return request("/api/skills/mcp-servers", { tenantSlug });
}

export function setMcpServerEnabled(
  tenantSlug: string,
  serverId: string,
  enabled: boolean,
): Promise<unknown> {
  return request(`/api/skills/mcp-servers/${serverId}`, {
    method: "PUT",
    tenantSlug,
    body: JSON.stringify({ enabled }),
  });
}

export function deleteMcpServer(
  tenantSlug: string,
  serverId: string,
): Promise<unknown> {
  return request(`/api/skills/mcp-servers/${serverId}`, {
    method: "DELETE",
    tenantSlug,
  });
}

export function listUserMcpServers(
  tenantId: string,
  userId: string,
): Promise<{ servers: McpServer[] }> {
  return request("/api/skills/user-mcp-servers", {
    tenantSlug: "",
    extraHeaders: {
      "x-tenant-id": tenantId,
      "x-principal-id": userId,
    },
  });
}

export function clearUserMcpToken(
  tenantId: string,
  userId: string,
  serverId: string,
): Promise<unknown> {
  return request(`/api/skills/user-mcp-tokens/${serverId}`, {
    method: "DELETE",
    tenantSlug: "",
    extraHeaders: {
      "x-tenant-id": tenantId,
      "x-principal-id": userId,
    },
  });
}

export function buildMcpOAuthAuthorizeUrl({
  mcpServerId,
  userId,
  tenantId,
  returnTo,
  force = true,
}: {
  mcpServerId: string;
  userId: string;
  tenantId: string;
  returnTo: string;
  force?: boolean;
}): string {
  const baseUrl =
    API_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost");
  const url = new URL("/api/skills/mcp-oauth/authorize", baseUrl);
  url.searchParams.set("mcpServerId", mcpServerId);
  url.searchParams.set("userId", userId);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("returnTo", returnTo);
  if (force) url.searchParams.set("force", "true");
  return url.toString();
}
