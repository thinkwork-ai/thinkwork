const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
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

// ---------------------------------------------------------------------------
// Tenant-level MCP registry
// ---------------------------------------------------------------------------

export function listMcpServers(
  tenantSlug: string,
): Promise<{ servers: McpServer[] }> {
  return apiFetch("/api/skills/mcp-servers", {
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function registerMcpServer(
  tenantSlug: string,
  config: McpServerInput,
): Promise<{ id: string; slug: string }> {
  return apiFetch("/api/skills/mcp-servers", {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(config),
  });
}

export function updateMcpServer(
  tenantSlug: string,
  serverId: string,
  updates: Partial<McpServerInput & { enabled: boolean }>,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/mcp-servers/${serverId}`, {
    method: "PUT",
    headers: { "x-tenant-slug": tenantSlug },
    body: JSON.stringify(updates),
  });
}

export function deleteMcpServer(
  tenantSlug: string,
  serverId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/mcp-servers/${serverId}`, {
    method: "DELETE",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

export function testMcpServer(
  tenantSlug: string,
  serverId: string,
): Promise<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string }> {
  return apiFetch(`/api/skills/mcp-servers/${serverId}/test`, {
    method: "POST",
    headers: { "x-tenant-slug": tenantSlug },
  });
}

// ---------------------------------------------------------------------------
// Agent-level MCP assignment
// ---------------------------------------------------------------------------

export function listAgentMcpServers(
  agentId: string,
): Promise<{ servers: AgentMcpServer[] }> {
  return apiFetch(`/api/skills/agents/${agentId}/mcp-servers`);
}

export function assignMcpToAgent(
  agentId: string,
  mcpServerId: string,
  config?: Record<string, unknown>,
): Promise<{ id: string }> {
  return apiFetch(`/api/skills/agents/${agentId}/mcp-servers`, {
    method: "POST",
    body: JSON.stringify({ mcpServerId, config }),
  });
}

export function unassignMcpFromAgent(
  agentId: string,
  mcpServerId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/agents/${agentId}/mcp-servers/${mcpServerId}`, {
    method: "DELETE",
  });
}
