import { apiFetch, ApiError } from "@/lib/api-fetch";

// Minimal MCP-servers client (same REST endpoints admin uses). Spaces Settings
// exposes list + enable/disable + remove; register/test/discover/OAuth stay
// admin-only for now.

export type McpApprovalStatus = "pending" | "approved" | "rejected" | string;

export type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status?: McpApprovalStatus;
  tools?: Array<{ name: string; description?: string }>;
};

async function request<T>(
  path: string,
  options: { method?: string; body?: string; tenantSlug: string },
): Promise<T> {
  const { tenantSlug, ...rest } = options;
  try {
    return await apiFetch<T>(path, {
      ...rest,
      extraHeaders: { "x-tenant-slug": tenantSlug },
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
