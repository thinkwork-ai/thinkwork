import { apiFetch, ApiError } from "@/lib/api-fetch";
import { readRuntimeEnv } from "@/lib/runtime-config";

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
  runtimeAssigned?: boolean;
  runtimeEnabled?: boolean;
  /**
   * THINK-239: analyst data-source coordinates — present only on analyst
   * connector rows. `host` is null for the builtin workspace connector;
   * `kind` says whether the database lives on an environment-owned cluster.
   */
  dataSource?: {
    kind: "internal" | "external";
    host: string | null;
    database: string;
    /** THINK-283: the source's ONE schema (legacy rows project "public"). */
    schema: string;
    /** THINK-283: durable explicit-refresh state; null = never refreshed. */
    refresh: {
      status: "running" | "failed" | "ok";
      detail?: string | null;
      updatedAt?: string | null;
    } | null;
  } | null;
};

export type McpServiceCredentialStatus = {
  authType: string;
  credentialKind?: string | null;
  hasCredential: boolean;
  lastFour?: string | null;
  secretRefConfigured: boolean;
  headerName?: string | null;
  secretJsonKey?: string | null;
};

export type RuntimeMcpTool = {
  name: string;
  server: string;
  tool: string;
  description?: string;
  inputSchema?: unknown;
};

export type AgentCoreOAuthStatus =
  | "connected"
  | "authorization_required"
  | "in_progress"
  | "failed";

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

export function createMcpServer(
  tenantSlug: string,
  payload: {
    name: string;
    url: string;
    transport?: string;
    authType?: string;
    apiKey?: string;
  },
): Promise<{ id: string; slug: string; created?: boolean; updated?: boolean }> {
  return request("/api/skills/mcp-servers", {
    method: "POST",
    tenantSlug,
    body: JSON.stringify(payload),
  });
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

/**
 * THINK-173 U12: automations referencing a workspace tool (Composer
 * delete-warning count). Non-blocking advisory — deletion stays legal.
 */
export function getToolAutomationRefs(
  tenantSlug: string,
  agentId: string,
  toolSlug: string,
): Promise<{ count: number; automations: { id: string; name: string }[] }> {
  return request(
    `/api/skills/tool-automation-refs?agentId=${encodeURIComponent(agentId)}&toolSlug=${encodeURIComponent(toolSlug)}`,
    { tenantSlug },
  );
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

export function getMcpServiceCredentialStatus(
  tenantSlug: string,
  serverId: string,
): Promise<McpServiceCredentialStatus> {
  return request(
    `/api/skills/mcp-servers/${serverId}/service-credential-status`,
    { tenantSlug },
  );
}

export function saveMcpServiceCredential(
  tenantSlug: string,
  serverId: string,
  token: string,
): Promise<{
  ok: boolean;
  lastFour?: string | null;
  headerName?: string | null;
  secretJsonKey?: string | null;
}> {
  return request(`/api/skills/mcp-servers/${serverId}/service-credential`, {
    method: "PUT",
    tenantSlug,
    body: JSON.stringify({ token }),
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

export function listRuntimeMcpTools(
  agentId: string,
): Promise<{ tools: RuntimeMcpTool[]; errors?: unknown[] }> {
  return request("/api/mcp/tools/list", {
    method: "POST",
    tenantSlug: "",
    body: JSON.stringify({ agentId }),
  });
}

export function callRuntimeMcpTool(
  agentId: string,
  server: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}> {
  return request("/api/mcp/tools/call", {
    method: "POST",
    tenantSlug: "",
    body: JSON.stringify({
      agentId,
      server,
      tool,
      arguments: args,
    }),
  });
}

export function buildMcpOAuthAuthorizeUrl({
  mcpServerId,
  userId,
  tenantId,
  returnTo,
  force = true,
  response,
}: {
  mcpServerId: string;
  userId: string;
  tenantId: string;
  returnTo: string;
  force?: boolean;
  response?: "json";
}): string {
  const baseUrl =
    readRuntimeEnv("VITE_API_URL") ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost");
  const url = new URL("/api/skills/mcp-oauth/authorize", baseUrl);
  url.searchParams.set("mcpServerId", mcpServerId);
  url.searchParams.set("userId", userId);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("returnTo", returnTo);
  if (force) url.searchParams.set("force", "true");
  if (response) url.searchParams.set("response", response);
  return url.toString();
}

export async function resolveMcpOAuthAuthorizeUrl(input: {
  mcpServerId: string;
  userId: string;
  tenantId: string;
  returnTo: string;
  force?: boolean;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      buildMcpOAuthAuthorizeUrl({ ...input, response: "json" }),
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  } catch {
    return buildMcpOAuthAuthorizeUrl(input);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `MCP OAuth authorize failed (${response.status})`;
    throw new Error(message);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { authorizeUrl?: unknown }).authorizeUrl !== "string"
  ) {
    throw new Error("MCP OAuth authorize response was invalid");
  }

  return (body as { authorizeUrl: string }).authorizeUrl;
}

export function getAgentCoreOAuthStatus(
  tenantSlug: string,
): Promise<{ status: AgentCoreOAuthStatus }> {
  return request("/api/skills/mcp-oauth/agentcore/status", { tenantSlug });
}

export function startAgentCoreOAuth(
  tenantSlug: string,
  returnTo: string,
): Promise<{
  status: AgentCoreOAuthStatus;
  authorizationUrl?: string;
  sessionUri?: string;
}> {
  const params = new URLSearchParams({ returnTo });
  return request(`/api/skills/mcp-oauth/agentcore/start?${params}`, {
    method: "POST",
    tenantSlug,
  });
}

export function isManagedMcpServer(server: McpServer): boolean {
  return (
    server.managementSource === "managed_application" ||
    Boolean(server.managedApplicationKey)
  );
}

export function isPluginInstalledMcpServer(server: McpServer): boolean {
  return (
    server.managementSource === "plugin" ||
    server.managementSource === "managed_application" ||
    Boolean(server.managedApplicationKey)
  );
}
