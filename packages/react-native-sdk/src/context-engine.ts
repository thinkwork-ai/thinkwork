import { getAuthToken } from "./graphql/token";

export type ContextEngineMode = "results" | "answer";
export type ContextEngineScope = "personal" | "team" | "auto";
export type ContextEngineDepth = "quick" | "deep";
export type ContextProviderFamily =
  | "memory"
  | "brain"
  | "wiki"
  | "workspace"
  | "knowledge-base"
  | "mcp"
  | "sub-agent";
export type ContextSourceFamily =
  | "brain"
  | "pages"
  | "workspace"
  | "knowledge-base"
  | "web"
  | "mcp"
  | "source-agent";

export interface ContextEngineHit {
  id: string;
  providerId: string;
  family: ContextProviderFamily;
  sourceFamily?: ContextSourceFamily;
  title: string;
  snippet: string;
  score?: number | null;
  rank?: number | null;
  scope: ContextEngineScope;
  provenance: {
    label?: string;
    uri?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  freshness?: {
    asOf: string;
    ttlSeconds: number;
  };
}

export interface ContextProviderStatus {
  providerId: string;
  family: ContextProviderFamily;
  sourceFamily?: ContextSourceFamily;
  displayName: string;
  state: "ok" | "skipped" | "error" | "timeout" | "stale";
  error?: string;
  reason?: string;
  hitCount?: number;
  durationMs?: number;
  defaultEnabled?: boolean;
  freshness?: {
    asOf: string;
    ttlSeconds: number;
  };
}

export interface ContextEngineResponse {
  query: string;
  mode: ContextEngineMode;
  scope: ContextEngineScope;
  depth: ContextEngineDepth;
  hits: ContextEngineHit[];
  providers: ContextProviderStatus[];
  answer?: { text: string; hitIds: string[] };
  traceId?: string | null;
}

export interface QueryContextArgs {
  apiBaseUrl: string;
  query: string;
  mode?: ContextEngineMode;
  scope?: ContextEngineScope;
  depth?: ContextEngineDepth;
  limit?: number;
  providers?: {
    ids?: string[];
    families?: ContextProviderFamily[];
  };
  providerOptions?: {
    memory?: {
      queryMode?: "recall" | "reflect";
    };
  };
}

export async function queryContext(
  args: QueryContextArgs,
): Promise<ContextEngineResponse> {
  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");
  const response = await fetch(
    `${args.apiBaseUrl.replace(/\/$/, "")}/mcp/context-engine`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mobile-query-context",
        method: "tools/call",
        params: {
          name: "query_context",
          arguments: {
            query: args.query,
            mode: args.mode ?? "results",
            scope: args.scope ?? "auto",
            depth: args.depth ?? "quick",
            limit: args.limit,
            providers: args.providers,
            providerOptions: args.providerOptions,
          },
        },
      }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message || `Context Engine HTTP ${response.status}`,
    );
  }
  return payload.result?.structuredContent as ContextEngineResponse;
}
