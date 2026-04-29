import { apiFetch, ApiError } from "@/lib/api-fetch";
import { getIdToken } from "@/lib/auth";

// Base URL retained for `cognitoFetch` below (MCP-approval flow uses a
// Cognito-only route that's orthogonal to apiFetch's apikey-accepting
// handler). VITE_API_AUTH_SECRET intentionally removed — the admin
// bundle no longer ships a service secret.
const API_URL = import.meta.env.VITE_API_URL || "";

// Preserve the legacy external error shape (`new Error(body.error || "HTTP N")`)
// so consumers that string-match on the message keep working. apiFetch already
// surfaces the best-effort error body; we just re-throw as a plain Error.
async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<T> {
  try {
    return await apiFetch<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
      throw new Error(body?.error || `HTTP ${err.status}`);
    }
    throw err;
  }
}

/**
 * Cognito-authenticated fetch for routes gated by requireTenantAdmin.
 * The mcp-approval handler rejects service-key callers without a
 * principal-id header, so approve/reject flow through Cognito only.
 */
async function cognitoFetch(path: string, options: RequestInit = {}) {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpApprovalStatus = "pending" | "approved" | "rejected";

export type McpServer = {
  id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  authType: string;
  oauthProvider?: string;
  tools?: Array<{ name: string; description?: string }>;
  enabled: boolean;
  createdAt?: string;
  status?: McpApprovalStatus;
  urlHash?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
};

export type McpServerInput = {
  name: string;
  url: string;
  transport?: string;
  authType?: string;
  apiKey?: string;
  oauthProvider?: string;
};

export type AgentMcpServer = McpServer & {
  mcpServerId: string;
  config?: Record<string, unknown>;
};

export type McpContextTool = {
  id: string;
  tenantId: string;
  mcpServerId: string;
  toolName: string;
  displayName: string | null;
  declaredReadOnly: boolean;
  declaredSearchSafe: boolean;
  approved: boolean;
  defaultEnabled: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Tenant-level MCP registry
// ---------------------------------------------------------------------------

export function listMcpServers(
  tenantSlug: string,
): Promise<{ servers: McpServer[] }> {
  return request("/api/skills/mcp-servers", {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function registerMcpServer(
  tenantSlug: string,
  config: McpServerInput,
): Promise<{ id: string; slug: string }> {
  return request("/api/skills/mcp-servers", {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(config),
  });
}

export function updateMcpServer(
  tenantSlug: string,
  serverId: string,
  updates: Partial<McpServerInput & { enabled: boolean }>,
): Promise<{ ok: boolean }> {
  return request(`/api/skills/mcp-servers/${serverId}`, {
    method: "PUT",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(updates),
  });
}

export function deleteMcpServer(
  tenantSlug: string,
  serverId: string,
): Promise<{ ok: boolean }> {
  return request(`/api/skills/mcp-servers/${serverId}`, {
    method: "DELETE",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function testMcpServer(
  tenantSlug: string,
  serverId: string,
): Promise<{
  ok: boolean;
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}> {
  return request(`/api/skills/mcp-servers/${serverId}/test`, {
    method: "POST",
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function listMcpContextTools(
  tenantSlug: string,
  serverId: string,
): Promise<{ tools: McpContextTool[] }> {
  return request(`/api/skills/mcp-servers/${serverId}/context-tools`, {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

export function updateMcpContextTool(
  tenantSlug: string,
  toolId: string,
  updates: { approved?: boolean; defaultEnabled?: boolean },
): Promise<{ tool: McpContextTool }> {
  return request(`/api/skills/mcp-context-tools/${toolId}`, {
    method: "PUT",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(updates),
  });
}

// ---------------------------------------------------------------------------
// Tenant-wide API key management for tenant_api_key MCP servers
// ---------------------------------------------------------------------------

export type McpKeyStatus = {
  authType: string;
  hasKey: boolean;
  lastFour: string | null;
};

export function getMcpKeyStatus(
  tenantSlug: string,
  serverId: string,
): Promise<McpKeyStatus> {
  return request(`/api/skills/mcp-servers/${serverId}/key-status`, {
    extraHeaders: { "x-tenant-slug": tenantSlug },
  });
}

/**
 * Set or rotate the tenant API key for a `tenant_api_key` MCP server.
 * Two modes:
 *   - `{ apiKey }` — store a caller-supplied token (paste flow)
 *   - `{ mintNew: true }` — auto-generate a tkm_ token server-side
 * Response carries the last-4 preview so the row can update without a
 * second fetch.
 */
export function setMcpApiKey(
  tenantSlug: string,
  serverId: string,
  body: { apiKey: string } | { mintNew: true },
): Promise<{ ok: boolean; lastFour: string; minted: boolean }> {
  return request(`/api/skills/mcp-servers/${serverId}/api-key`, {
    method: "PUT",
    extraHeaders: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Template MCP assignments
// ---------------------------------------------------------------------------

export function getTemplateMcpServers(
  templateId: string,
): Promise<{
  mcpServers: Array<{
    mcp_server_id: string;
    enabled: boolean;
    name?: string;
    url?: string;
    authType?: string;
  }>;
}> {
  return request(`/api/skills/templates/${templateId}/mcp-servers`);
}

export function assignMcpToTemplate(
  templateId: string,
  mcpServerId: string,
): Promise<{ id: string }> {
  return request(`/api/skills/templates/${templateId}/mcp-servers`, {
    method: "POST",
    body: JSON.stringify({ mcpServerId }),
  });
}

export function unassignMcpFromTemplate(
  templateId: string,
  mcpServerId: string,
): Promise<{ ok: boolean }> {
  return request(
    `/api/skills/templates/${templateId}/mcp-servers/${mcpServerId}`,
    {
      method: "DELETE",
    },
  );
}

// ---------------------------------------------------------------------------
// OAuth providers (for admin registration dropdown)
// ---------------------------------------------------------------------------

export type OAuthProvider = {
  id: string;
  name: string;
  displayName: string;
  providerType: string;
};

export function listOAuthProviders(): Promise<{ providers: OAuthProvider[] }> {
  return request("/api/skills/oauth-providers");
}

// ---------------------------------------------------------------------------
// Agent-level MCP assignment
// ---------------------------------------------------------------------------

export function listAgentMcpServers(
  agentId: string,
): Promise<{ servers: AgentMcpServer[] }> {
  return request(`/api/skills/agents/${agentId}/mcp-servers`);
}

export function assignMcpToAgent(
  agentId: string,
  mcpServerId: string,
  config?: Record<string, unknown>,
): Promise<{ id: string }> {
  return request(`/api/skills/agents/${agentId}/mcp-servers`, {
    method: "POST",
    body: JSON.stringify({ mcpServerId, config }),
  });
}

export function unassignMcpFromAgent(
  agentId: string,
  mcpServerId: string,
): Promise<{ ok: boolean }> {
  return request(`/api/skills/agents/${agentId}/mcp-servers/${mcpServerId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Admin approval (plan §U11). Cognito JWT only — gated by requireTenantAdmin.
// ---------------------------------------------------------------------------

export function approveMcpServer(
  tenantId: string,
  serverId: string,
): Promise<{
  id: string;
  status: "approved";
  url_hash: string;
  approved_by: string;
  approved_at: string;
}> {
  return cognitoFetch(
    `/api/tenants/${tenantId}/mcp-servers/${serverId}/approve`,
    { method: "POST" },
  );
}

export function rejectMcpServer(
  tenantId: string,
  serverId: string,
  reason?: string,
): Promise<{ id: string; status: "rejected"; reason: string | null }> {
  return cognitoFetch(
    `/api/tenants/${tenantId}/mcp-servers/${serverId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}
