import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  tenantMcpContextTools,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import {
  applyTenantContextProviderSettings,
  loadTenantContextProviderSettings,
  memoryProviderConfig,
  type TenantContextProviderSetting,
} from "../admin-config.js";
import type { ContextProviderDescriptor } from "../types.js";
import { createBedrockKnowledgeBaseContextProvider } from "./bedrock-knowledge-base.js";
import { createMemoryContextProvider } from "./memory.js";
import { createMcpToolContextProvider } from "./mcp-tool.js";
import { createWorkspaceFilesContextProvider } from "./workspace-files.js";
import { createWikiContextProvider } from "./wiki.js";

export function createCoreContextProviders(
  settings: TenantContextProviderSetting[] = [],
): ContextProviderDescriptor[] {
  const memoryConfig = memoryProviderConfig(settings);
  const providers = [
    createMemoryContextProvider(memoryConfig),
    createWikiContextProvider(),
    createWorkspaceFilesContextProvider(),
    createBedrockKnowledgeBaseContextProvider(),
  ];
  return applyTenantContextProviderSettings(providers, settings);
}

export async function createContextProvidersForCaller(caller?: {
  tenantId: string;
  userId?: string | null;
  agentId?: string | null;
}): Promise<ContextProviderDescriptor[]> {
  const providers = caller?.tenantId
    ? createCoreContextProviders(
        await loadTenantContextProviderSettings(caller.tenantId),
      )
    : createCoreContextProviders();
  if (!caller?.tenantId) return providers;
  return [...providers, ...(await createTenantMcpContextProviders(caller))];
}

async function createTenantMcpContextProviders(caller: {
  tenantId: string;
  userId?: string | null;
  agentId?: string | null;
}): Promise<ContextProviderDescriptor[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: tenantMcpContextTools.id,
      toolName: tenantMcpContextTools.tool_name,
      displayName: tenantMcpContextTools.display_name,
      defaultEnabled: tenantMcpContextTools.default_enabled,
      serverName: tenantMcpServers.name,
      serverSlug: tenantMcpServers.slug,
      serverUrl: tenantMcpServers.url,
      authType: tenantMcpServers.auth_type,
      authConfig: tenantMcpServers.auth_config,
    })
    .from(tenantMcpContextTools)
    .innerJoin(
      tenantMcpServers,
      eq(tenantMcpContextTools.mcp_server_id, tenantMcpServers.id),
    )
    .where(
      and(
        eq(tenantMcpContextTools.tenant_id, caller.tenantId),
        eq(tenantMcpContextTools.approved, true),
        eq(tenantMcpServers.enabled, true),
        eq(tenantMcpServers.status, "approved"),
      ),
    );

  return rows.map((row) =>
    createMcpToolContextProvider({
      id: `mcp:${row.id}`,
      displayName: row.displayName || `${row.serverName} ${row.toolName}`,
      serverName: row.serverSlug,
      toolName: row.toolName,
      defaultEnabled: row.defaultEnabled,
      callTool: async ({ toolName, query, limit }) =>
        callTenantMcpTool({
          url: row.serverUrl,
          authType: row.authType,
          authConfig: row.authConfig as Record<string, unknown> | null,
          toolName,
          query,
          limit,
        }),
    }),
  );
}

async function callTenantMcpTool(args: {
  url: string;
  authType: string;
  authConfig: Record<string, unknown> | null;
  toolName: string;
  query: string;
  limit: number;
}): Promise<{
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (args.authType === "tenant_api_key") {
    const token =
      typeof args.authConfig?.token === "string" ? args.authConfig.token : "";
    if (!token) {
      return { isError: true, content: "Tenant MCP API key is not configured" };
    }
    headers.Authorization = `Bearer ${token}`;
  } else if (args.authType !== "none") {
    return {
      isError: true,
      content: `Context Engine MCP provider does not support auth_type ${args.authType}`,
    };
  }

  const response = await fetch(args.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "context-engine-mcp-tool",
      method: "tools/call",
      params: {
        name: args.toolName,
        arguments: {
          query: args.query,
          limit: args.limit,
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    result?: {
      content?: unknown;
      structuredContent?: unknown;
      isError?: boolean;
    };
    error?: unknown;
  };
  if (!response.ok || payload.error) {
    return {
      isError: true,
      content:
        typeof payload.error === "object"
          ? JSON.stringify(payload.error)
          : String(payload.error || `MCP server returned ${response.status}`),
    };
  }
  return {
    content: payload.result?.content,
    structuredContent: payload.result?.structuredContent,
    isError: payload.result?.isError,
  };
}

export { createBedrockKnowledgeBaseContextProvider } from "./bedrock-knowledge-base.js";
export { createMemoryContextProvider } from "./memory.js";
export { createMcpToolContextProvider } from "./mcp-tool.js";
export { createWorkspaceFilesContextProvider } from "./workspace-files.js";
export { createWikiContextProvider } from "./wiki.js";
