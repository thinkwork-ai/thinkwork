import { apiFetch, ApiError } from "@/lib/api-fetch";

type JsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: { code?: number; message?: string };
};

export type ContextProviderSummary = {
  id: string;
  family: string;
  displayName: string;
  enabled?: boolean;
  defaultEnabled: boolean;
  config?: Record<string, unknown>;
  lastTestedAt?: string | null;
  lastTestState?: string | null;
  lastTestLatencyMs?: number | null;
  lastTestError?: string | null;
};

export type ContextProviderStatus = {
  providerId: string;
  family: string;
  displayName: string;
  state: "ok" | "skipped" | "error" | "timeout" | "stale";
  scope: string;
  durationMs?: number;
  hitCount?: number;
  error?: string;
  reason?: string;
  defaultEnabled?: boolean;
  freshness?: { asOf: string; ttlSeconds: number };
};

export type ContextHit = {
  id: string;
  providerId: string;
  family: string;
  title: string;
  snippet: string;
  score?: number | null;
  rank?: number | null;
  scope?: string;
  provenance?: {
    label?: string;
    uri?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  freshness?: { asOf: string; ttlSeconds: number };
};

export type ContextQueryResult = {
  query: string;
  mode: string;
  scope: string;
  depth: string;
  hits: ContextHit[];
  providers: ContextProviderStatus[];
  answer?: { text: string; hitIds: string[] };
};

export type QueryContextEngineOptions = {
  providerIds?: string[];
  memoryQueryMode?: "recall" | "reflect";
  memoryIncludeLegacyBanks?: boolean;
  agentId?: string;
};

export type ContextTestAgent = {
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
};

export type AgentContextPolicy = {
  agentId: string;
  enabled: boolean;
  tenantDefaults: ContextProviderSummary[];
  templateOverride: {
    mode: "inherit" | "override";
    providerIds: string[];
  };
  finalProviders: ContextProviderSummary[];
  providerOptions?: Record<string, unknown>;
  agentDrift: Array<{ label: string; value: string }>;
};

async function callContextTool<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    const response = await apiFetch<
      JsonRpcResponse<{
        structuredContent?: T;
        content?: Array<{ type: string; text?: string }>;
      }>
    >("/mcp/context-engine", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `admin-${name}`,
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      }),
    });

    if (response.error) {
      throw new Error(
        response.error.message || "Context Engine request failed",
      );
    }
    const structured = response.result?.structuredContent;
    if (!structured)
      throw new Error("Context Engine returned no structured content");
    return structured;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = err.body as
        | JsonRpcResponse<unknown>
        | { error?: string }
        | null;
      if (body && typeof body === "object" && "error" in body) {
        const error = body.error;
        if (typeof error === "string") throw new Error(error);
        if (error && typeof error === "object" && "message" in error) {
          throw new Error(String((error as { message?: unknown }).message));
        }
      }
    }
    throw err;
  }
}

export async function listContextProviders(): Promise<
  ContextProviderSummary[]
> {
  const result = await callContextTool<{ providers: ContextProviderSummary[] }>(
    "list_context_providers",
  );
  return result.providers ?? [];
}

export async function updateContextProviderSetting(input: {
  providerId: string;
  enabled: boolean;
  defaultEnabled: boolean;
  config?: Record<string, unknown>;
}): Promise<ContextProviderSummary> {
  const result = await callContextTool<{ setting: ContextProviderSummary }>(
    "update_context_provider_setting",
    input,
  );
  return result.setting;
}

export async function listContextTestAgents(
  tenantId: string,
): Promise<ContextTestAgent[]> {
  const rows = await apiFetch<Array<Record<string, unknown>>>("/api/agents", {
    extraHeaders: { "x-tenant-id": tenantId },
  });
  return rows
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Untitled agent"),
      slug: typeof row.slug === "string" ? row.slug : null,
      status: typeof row.status === "string" ? row.status : null,
    }))
    .filter((agent) => agent.id);
}

export async function getAgentContextPolicy(
  agentId: string,
): Promise<AgentContextPolicy> {
  return callContextTool<AgentContextPolicy>("get_agent_context_policy", {
    agentId,
  });
}

export function queryContextEngine(
  query: string,
  options: QueryContextEngineOptions = {},
): Promise<ContextQueryResult> {
  return callContextTool<ContextQueryResult>("query_context", {
    query,
    mode: "results",
    scope: "auto",
    depth: "quick",
    limit: 10,
    ...(options.providerIds && options.providerIds.length > 0
      ? { providers: { ids: options.providerIds } }
      : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.memoryQueryMode
      ? {
          providerOptions: {
            memory: {
              queryMode: options.memoryQueryMode,
              includeLegacyBanks: options.memoryIncludeLegacyBanks,
            },
          },
        }
      : {}),
  });
}
