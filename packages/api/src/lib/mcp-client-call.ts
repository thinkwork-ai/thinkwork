/**
 * Minimal MCP JSON-RPC client for streamable-HTTP servers.
 *
 * `packages/api` does NOT depend on `@modelcontextprotocol/sdk` (that lives in
 * `packages/agentcore-pi`, which is Node/native and outside the Lambda bundle).
 * The tenant MCP servers ThinkWork talks to speak plain JSON-RPC 2.0 over a
 * single HTTP POST (streamable-http), so this helper makes that call directly
 * with `fetch` — the same wire shape the device client (`apps/mobile/lib/
 * mcp-client.ts`) and the agentcore-pi adapter (`mcp-connect.ts`) use.
 *
 * It mirrors the SDK adapter's transport/version handling where it matters:
 *   - The MCP session lifecycle: `initialize` → `notifications/initialized` →
 *     the real request, carrying any `Mcp-Session-Id` the server assigns on
 *     initialize back on subsequent requests. Spec-compliant streamable-HTTP
 *     servers reject `tools/list`/`tools/call` on a cold connection, so the SDK
 *     (which agentcore-pi uses via `client.connect()`) always does this — we
 *     replicate it here with raw fetch since `@modelcontextprotocol/sdk` is not
 *     a `packages/api` dependency.
 *   - JSON-RPC 2.0 envelope with `MCP-Protocol-Version` + JSON/SSE Accept.
 *   - `tools/list` → `{ name, description, inputSchema }[]`.
 *   - `tools/call` → `{ content, isError }`; an MCP `isError` result is RETURNED
 *     (not thrown) so the caller can forward it as a recoverable tool-result.
 *   - `textFromMcpContent` matches `mcp-connect.ts` so content flattening is
 *     consistent across runtimes.
 *
 * Used by the mobile-facing `mcp-proxy` handler; kept transport-only (no auth /
 * tenant logic) so it can be reused if another caller needs a server-side MCP
 * call.
 */

/** MCP protocol version we advertise. Matches the agentcore-pi SDK pin era. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TOOL_TIMEOUT_MS = 60_000;

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallToolResult {
  content: unknown;
  isError: boolean;
  /** The raw JSON-RPC `result` object for callers that want structured data. */
  raw: unknown;
}

export interface McpServerTarget {
  /** Absolute URL of the MCP server endpoint. */
  url: string;
  /** Optional bearer token (per-user OAuth or tenant API key). */
  token?: string;
  /** Display name; used only in error messages. */
  name?: string;
}

/** Raised on transport-level failure (non-2xx, network error, JSON-RPC error). */
export class McpTransportError extends Error {
  constructor(
    message: string,
    readonly serverName?: string,
  ) {
    super(message);
    this.name = "McpTransportError";
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const SESSION_HEADER = "mcp-session-id";

function baseHeaders(target: McpServerTarget): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Tenant MCP servers (streamable-http) may stream the response as SSE,
    // so advertise both — matches what the SDK transport sends.
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  return headers;
}

/** One raw JSON-RPC POST. Returns the Response so callers can read session headers. */
async function post(
  target: McpServerTarget,
  payload: Record<string, unknown>,
  sessionId: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers = baseHeaders(target);
  if (sessionId) headers[SESSION_HEADER] = sessionId;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(target.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new McpTransportError(
      `MCP request to ${target.name ?? target.url} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      target.name,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function ensureOk(resp: Response, target: McpServerTarget): void {
  if (resp.ok) return;
  throw new McpTransportError(
    `MCP server ${target.name ?? target.url} returned ${resp.status}`,
    target.name,
  );
}

/**
 * Open an MCP session: `initialize`, capture any `Mcp-Session-Id`, then send the
 * `notifications/initialized` ack the spec requires before real requests. The SDK
 * does this inside `client.connect()`; we replicate it so spec-strict
 * streamable-HTTP servers accept the subsequent tools/list|tools/call.
 */
async function initializeSession(
  target: McpServerTarget,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const resp = await post(
    target,
    {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "thinkwork-mcp-proxy", version: "0.0.0" },
      },
    },
    undefined,
    timeoutMs,
    fetchImpl,
  );
  ensureOk(resp, target);
  const sessionId = resp.headers.get(SESSION_HEADER) ?? undefined;
  const data = await parseRpcBody(resp, target);
  if (data.error) {
    throw new McpTransportError(
      `MCP server ${target.name ?? target.url} rejected initialize: ${
        data.error.message ?? "unknown"
      }`,
      target.name,
    );
  }
  // Fire-and-forget the initialized notification (no id → no response expected).
  // A server that 404s/errors this is tolerated: many accept requests anyway.
  try {
    const ack = await post(
      target,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      sessionId,
      timeoutMs,
      fetchImpl,
    );
    // Drain the body so the socket can be reused; ignore the status.
    await ack.text().catch(() => "");
  } catch {
    // Non-fatal — the session is already established by initialize.
  }
  return sessionId;
}

async function rpc(
  target: McpServerTarget,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  // MCP session lifecycle: initialize (+ initialized ack) before the real call.
  const sessionId = await initializeSession(target, timeoutMs, fetchImpl);

  const resp = await post(
    target,
    { jsonrpc: "2.0", id: 1, method, params },
    sessionId,
    timeoutMs,
    fetchImpl,
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new McpTransportError(
      `MCP server ${target.name ?? target.url} returned ${resp.status}: ${text.slice(0, 200)}`,
      target.name,
    );
  }

  const data = await parseRpcBody(resp, target);
  if (data.error) {
    throw new McpTransportError(
      `MCP server ${target.name ?? target.url} JSON-RPC error: ${
        data.error.message ?? "unknown"
      }`,
      target.name,
    );
  }
  return data.result;
}

/**
 * Streamable-http servers may answer a single JSON-RPC POST either as
 * `application/json` or as a one-shot SSE stream (`text/event-stream`). Parse
 * both so we don't depend on which the server chose.
 */
async function parseRpcBody(
  resp: Response,
  target: McpServerTarget,
): Promise<JsonRpcResponse> {
  const contentType = resp.headers.get("content-type") ?? "";
  const bodyText = await resp.text();
  if (contentType.includes("text/event-stream")) {
    // Concatenate every `data:` line and take the last JSON-RPC object.
    const dataLines = bodyText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(dataLines[i]) as JsonRpcResponse;
      } catch {
        // keep scanning earlier frames
      }
    }
    throw new McpTransportError(
      `MCP server ${target.name ?? target.url} returned an SSE body with no JSON-RPC frame`,
      target.name,
    );
  }
  try {
    return JSON.parse(bodyText) as JsonRpcResponse;
  } catch {
    throw new McpTransportError(
      `MCP server ${target.name ?? target.url} returned a non-JSON body`,
      target.name,
    );
  }
}

/** List the tools a single MCP server exposes. */
export async function mcpListTools(
  target: McpServerTarget,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<McpToolDefinition[]> {
  const result = (await rpc(
    target,
    "tools/list",
    {},
    opts.timeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS,
    opts.fetchImpl ?? fetch,
  )) as { tools?: unknown };
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map((t) => {
    const tool = (t ?? {}) as Record<string, unknown>;
    return {
      name: typeof tool.name === "string" ? tool.name : "",
      description:
        typeof tool.description === "string" ? tool.description : undefined,
      inputSchema: tool.inputSchema,
    };
  });
}

/** Call a single tool on an MCP server. MCP `isError` results are returned. */
export async function mcpCallTool(
  target: McpServerTarget,
  name: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<McpCallToolResult> {
  const result = (await rpc(
    target,
    "tools/call",
    { name, arguments: args },
    opts.timeoutMs ?? DEFAULT_CALL_TOOL_TIMEOUT_MS,
    opts.fetchImpl ?? fetch,
  )) as Record<string, unknown>;
  const content =
    "content" in result ? result.content : (result.toolResult ?? null);
  return {
    content,
    isError: result.isError === true,
    raw: result,
  };
}

/** Flatten MCP content blocks to text. Mirrors `mcp-connect.ts`. */
export function textFromMcpContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (record.resource && typeof record.resource === "object") {
        const resource = record.resource as Record<string, unknown>;
        if (typeof resource.text === "string") return resource.text;
        if (typeof resource.uri === "string") return resource.uri;
      }
      if (typeof record.uri === "string") return record.uri;
      return JSON.stringify(record);
    })
    .filter(Boolean)
    .join("\n");
}
