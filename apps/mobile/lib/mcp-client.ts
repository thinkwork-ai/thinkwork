/**
 * MCP Client — two surfaces.
 *
 * 1. `callMcpTool` (legacy): calls the shared ThinkWork Builder MCP server with a
 *    static bearer (EXPO_PUBLIC_MCP_BUILDER_URL / EXPO_PUBLIC_MCP_AUTH_TOKEN). Kept
 *    for existing callers; not tenant-scoped, no tools/list.
 * 2. `listTenantTools` + `callTenantTool` (the on-device agent path): hit the
 *    platform MCP proxy (`/api/mcp/tools/{list,call}`) authenticated as the signed-in
 *    user (Cognito idToken). The proxy resolves the agent's tenant MCP servers + auth
 *    server-side, so no long-lived secret lives on the device. These back the
 *    `mcpToolsExtension` (the harness's first Pi-style extension).
 */

const MCP_URL =
  process.env.EXPO_PUBLIC_MCP_BUILDER_URL ||
  "https://api.thinkwork.ai/mcp/builder";

const MCP_TOKEN = process.env.EXPO_PUBLIC_MCP_AUTH_TOKEN || "";

// apiBase = EXPO_PUBLIC_GRAPHQL_URL minus /graphql — same derivation the harness's
// BedrockModelProvider and persist-turn use, so all device→platform calls share one host.
const DEFAULT_API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

/** A tool definition returned by the proxy's tools/list. */
export interface TenantToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Result of a proxied tools/call. `isError` marks a recoverable tool failure. */
export interface TenantToolResult {
  content: unknown;
  isError?: boolean;
}

export interface TenantMcpDeps {
  /** Override the platform base URL (defaults to EXPO_PUBLIC_GRAPHQL_URL minus /graphql). */
  apiBase?: string;
  /** Resolve the caller's Cognito idToken. Defaults to a lazy import of lib/auth. */
  getToken?: () => Promise<string | null>;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

async function proxyPost(
  path: string,
  payload: Record<string, unknown>,
  deps: TenantMcpDeps,
): Promise<unknown> {
  const apiBase = deps.apiBase ?? DEFAULT_API_BASE;
  const getToken =
    deps.getToken ?? (async () => (await import("./auth")).getIdToken());
  const fetchImpl = deps.fetchImpl ?? fetch;

  const token = await getToken();
  if (!token) throw new Error("Not authenticated");

  const resp = await fetchImpl(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    error?: string;
    [k: string]: unknown;
  };
  if (!resp.ok) {
    throw new Error(
      `MCP proxy ${resp.status}: ${data.error ?? "request failed"}`,
    );
  }
  return data;
}

/** List the agent's tenant MCP tools via the proxy (idToken-authed). */
export async function listTenantTools(
  agentId: string,
  deps: TenantMcpDeps = {},
): Promise<TenantToolDef[]> {
  const data = (await proxyPost("/api/mcp/tools/list", { agentId }, deps)) as {
    tools?: TenantToolDef[];
  };
  return Array.isArray(data.tools) ? data.tools : [];
}

/** Call one tenant MCP tool via the proxy (idToken-authed). */
export async function callTenantTool(
  agentId: string,
  name: string,
  args: Record<string, unknown>,
  deps: TenantMcpDeps = {},
): Promise<TenantToolResult> {
  const data = (await proxyPost(
    "/api/mcp/tools/call",
    { agentId, name, arguments: args },
    deps,
  )) as TenantToolResult;
  return { content: data.content, isError: data.isError };
}

/** Flatten MCP content blocks to text for the harness tool result. */
export function tenantToolContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  const text = content
    .map((item) => {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === "string") return rec.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return text || JSON.stringify(content);
}

/**
 * Call an MCP tool on the Builder server via JSON-RPC 2.0.
 * Parses the first text content block from the tool result.
 */
export async function callMcpTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (MCP_TOKEN) {
    headers["Authorization"] = `Bearer ${MCP_TOKEN}`;
  }

  const resp = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `MCP request failed (${resp.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = await resp.json();

  if (data.error) {
    throw new Error(data.error.message || "MCP tool error");
  }

  const result = data.result;
  if (result?.isError) {
    const errText = result.content?.[0]?.text || "Tool execution failed";
    throw new Error(errText);
  }

  // Parse the text content block
  const textBlock = result?.content?.find((c: any) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in MCP response");
  }

  return JSON.parse(textBlock.text) as T;
}
