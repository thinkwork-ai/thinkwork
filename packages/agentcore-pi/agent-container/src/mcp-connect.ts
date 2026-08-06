/**
 * Plan §005 U9 — Real `connectMcpServer` factory.
 *
 * U7 left this slot pluggable so the MCP build path could be tested in
 * isolation. U9 plugs in the production implementation: a thin wrapper around
 * `@modelcontextprotocol/sdk`'s streamable-HTTP / SSE clients that:
 *
 * Pi does not natively speak MCP server config, so ThinkWork adapts MCP
 * servers into Pi `AgentTool[]` here. `pi-mcp-adapter` is a good candidate
 * for a later proxy-tool canary, but this bridge keeps the existing
 * per-user OAuth handle/scrubbing guarantees intact for v0.
 *
 *   - Honors the handle-shaped `Authorization: Handle <uuid>` header U7 mints
 *     (the bearer never appears here — at egress time, U16's worker-thread
 *     `fetch` interceptor swaps `Handle <uuid>` for `Bearer <bearer>` by
 *     consulting the trusted-side HandleStore).
 *   - Surfaces every tool the MCP server exposes (or the optional whitelist)
 *     as a Pi/pi-agent-core `AgentTool<any>`.
 *   - Pushes an async cleanup closure into the per-invocation cleanup queue
 *     so the transport + client are torn down on completion.
 *   - Caps connect + listTools + callTool with timeouts so a hung MCP server
 *     can't stall the entire build (per U7 cross-reviewer P2).
 *
 * Pure adapter: takes inputs (URL, headers, server name, transport hint),
 * returns a tool array; no module-load globals, no env reads. Tests can
 * exercise it end-to-end with mocked SDK Clients.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { Type, type TSchema } from "typebox";
import { transformMcpResultContent } from "@thinkwork/pi-runtime-core";
import type { ConnectMcpServerArgs, ConnectMcpServerFn } from "./mcp.js";
import { enrichMcpRecordLinks } from "./mcp-record-links.js";

/** Default per-RPC timeout; matches the legacy pi-mono MCP implementation. */
const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_READ_RESOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_WARM_PING_TIMEOUT_MS = 3_000;

/**
 * THINK-623 — explicit `connect` (MCP `initialize`) wall. The SDK would
 * otherwise apply its 60s default here, so a cold or unreachable MCP
 * server stalls the whole tool build for a minute before the failure
 * reaches `onConnectError` (`mcp_connect_failed`). Fail fast instead.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * THINK-623 — absolute ceiling for a single `callTool` on a server that
 * opted into the long-call profile. The per-attempt wall
 * (`callToolTimeoutMs`) still applies between progress notifications;
 * `maxTotalTimeout` bounds the total wall so a server that keeps
 * emitting progress forever can't pin the turn open indefinitely.
 */
const DEFAULT_LONG_CALL_MAX_TOTAL_TIMEOUT_MS = 480_000;

/**
 * THINK-623 — progress sink for long-call servers. The MCP SDK only
 * attaches `_meta.progressToken` to a request when an `onprogress`
 * callback is supplied, and only that token makes the server's progress
 * notifications routable back to this request — which is what
 * `resetTimeoutOnProgress` needs to push the per-attempt wall out. The
 * callback itself is intentionally inert: progress payloads are
 * server-controlled and this path runs inside the agent loop, so
 * anything noisier belongs behind the trusted handler's logger.
 */
function noteMcpProgress(): void {
  // Intentionally empty — see doc comment.
}

/** JSON-RPC "Method not found" — the server answered, so the transport is
 * alive even though it doesn't implement the optional MCP ping. */
const JSONRPC_METHOD_NOT_FOUND = -32601;

function isMethodNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === JSONRPC_METHOD_NOT_FOUND) return true;
  return (
    err instanceof Error && err.message.includes(`${JSONRPC_METHOD_NOT_FOUND}`)
  );
}

// ---------------------------------------------------------------------------
// THINK-586 U7 — warm-session MCP connection retention.
// ---------------------------------------------------------------------------

/**
 * One retained (warm-cached) MCP connection. `setFetch`/`setAuthorization`
 * repoint the transport's egress at the CURRENT turn's scrubbing fetch and
 * freshly minted handle — the per-turn HandleStore invariant holds because
 * the connect-time handle dies with its turn and every warm reuse re-mints.
 */
export interface RetainedMcpConnection {
  serverName: string;
  /** MCP-level liveness probe (protocol ping over the retained transport). */
  ping: (options: { timeout: number }) => Promise<unknown>;
  close: () => Promise<void>;
  setFetch: (fetchImpl: typeof fetch | undefined) => void;
  setAuthorization: (value: string) => void;
  /** True when the server connected with a handle-shaped Authorization. */
  hasAuthorization: boolean;
}

export interface McpRetentionRebindArgs {
  /** The current turn's egress (scrubbing) fetch. */
  fetch: typeof fetch;
  /**
   * Current-turn Authorization header value for a server that connected
   * with auth (`Handle <uuid>` minted into the current turn's HandleStore),
   * or null when unavailable — which fails the rebind (cold path).
   */
  authorizationForServer: (serverName: string) => string | null;
  pingTimeoutMs?: number;
}

/**
 * Holds MCP clients across turns for the warm-session cache (KTD6):
 * transport teardown is diverted here instead of the per-turn cleanup
 * queue, so a cached client survives the turn's `finally` drain and is
 * closed only when the cache entry is evicted (`close()`).
 */
export interface McpConnectionRetention {
  register(connection: RetainedMcpConnection): void;
  /** Repoint every retained transport at the current turn's fetch/handles,
   * then liveness-ping each server. Throws on any failure (caller evicts). */
  rebind(args: McpRetentionRebindArgs): Promise<void>;
  close(): Promise<void>;
  readonly size: number;
}

export function createMcpConnectionRetention(): McpConnectionRetention {
  const connections: RetainedMcpConnection[] = [];
  return {
    register(connection) {
      connections.push(connection);
    },
    async rebind(args) {
      for (const connection of connections) {
        connection.setFetch(args.fetch);
        if (connection.hasAuthorization) {
          const authorization = args.authorizationForServer(
            connection.serverName,
          );
          if (!authorization) {
            throw new Error(
              `warm MCP rebind: no current-turn authorization for server ${connection.serverName}`,
            );
          }
          connection.setAuthorization(authorization);
        }
      }
      const timeout = args.pingTimeoutMs ?? DEFAULT_WARM_PING_TIMEOUT_MS;
      await Promise.all(
        connections.map((c) =>
          c.ping({ timeout }).catch((err) => {
            // JSON-RPC -32601 (Method not found) IS a liveness proof: the
            // server parsed the request and answered over the retained
            // transport — it just doesn't implement the optional MCP ping.
            // Only transport-level failures (network error, timeout) mean
            // the connection is dead and the entry must be evicted.
            if (isMethodNotFound(err)) return undefined;
            throw err;
          }),
        ),
      );
    },
    async close() {
      await Promise.all(
        connections.map((c) => c.close().catch(() => undefined)),
      );
    },
    get size() {
      return connections.length;
    },
  };
}

interface IndirectFetchState {
  fetch: typeof fetch | undefined;
  authorization: string | null;
}

/**
 * Transport-egress indirection for retained connections: delegates to the
 * mutable per-turn fetch, and rewrites an existing Authorization header
 * (the connect-time `Handle <uuid>` frozen into the transport's
 * requestInit) with the current turn's re-minted value. Only rewrites
 * requests that already carry Authorization — unauthenticated servers
 * never gain a header.
 */
function makeIndirectFetch(state: IndirectFetchState): typeof fetch {
  const indirect = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const target = state.fetch ?? globalThis.fetch;
    if (state.authorization !== null) {
      if (input instanceof Request && input.headers.has("authorization")) {
        const headers = new Headers(input.headers);
        headers.set("authorization", state.authorization);
        input = new Request(input, { headers });
      } else if (init?.headers) {
        const headers = new Headers(init.headers);
        if (headers.has("authorization")) {
          headers.set("authorization", state.authorization);
          init = { ...init, headers };
        }
      }
    }
    return target(input as never, init);
  };
  return indirect as typeof fetch;
}
const MAX_EXPOSED_TOOL_NAME_LENGTH = 48;
const TRUNCATED_TOOL_NAME_HASH_LENGTH = 8;

export interface CreateConnectMcpServerOptions {
  /** Cleanup queue the trusted handler drains on completion. */
  cleanup: Array<() => Promise<void>>;
  /** Override `listTools` timeout (default 30s). */
  listToolsTimeoutMs?: number;
  /** Override `callTool` timeout (default 60s). */
  callToolTimeoutMs?: number;
  /** Override MCP App resource-read timeout (default 30s). */
  readResourceTimeoutMs?: number;
  /** Override `connect` (MCP `initialize`) timeout (default 10s). */
  connectTimeoutMs?: number;
  /**
   * THINK-623 — override the total wall for `callTool` on servers that
   * set `longRunning` (default 8 minutes). Ignored for every other
   * server.
   */
  longCallMaxTotalTimeoutMs?: number;
  /**
   * U16 — fetch interceptor used at MCP egress. Trusted-handler builds
   * one bound to the per-invocation `HandleStore` and bearer-scrubber
   * (see `createScrubbingFetch` in `scrubbing-fetch.ts`); the SDK
   * transports below pass it through to their internal HTTP layer via
   * the `opts.fetch` constructor option, replacing the default
   * `globalThis.fetch`. When omitted, the transports fall through to
   * the global fetch — that path emits handle-shaped Authorization to
   * the wire (which the MCP server rejects), so production callers
   * MUST supply this.
   */
  fetch?: typeof fetch;
  /**
   * Test seam — inject a custom transport factory. Production callers omit
   * this; the factory selects between StreamableHTTP and SSE based on the
   * `transport` hint U7 forwards from the McpServerConfig.
   */
  transportFactory?: (args: TransportFactoryArgs) => Transport;
  /**
   * Test seam — inject a custom Client factory. Production callers omit this.
   */
  clientFactory?: () => Client;
  /**
   * THINK-586 U7 — when present, connections are retained for the
   * warm-session cache: transport teardown registers here instead of the
   * per-turn cleanup queue, and the transport's fetch goes through a
   * mutable indirection so later turns can repoint it. Omitted (Lambda
   * path / non-cacheable turns) → behavior identical to before.
   */
  retention?: McpConnectionRetention;
}

export interface TransportFactoryArgs {
  url: URL;
  headers: Record<string, string>;
  transport: "streamable-http" | "sse";
  /** U16 — egress fetch interceptor; threaded through to the SDK transports. */
  fetch?: typeof fetch;
}

function defaultTransportFactory(args: TransportFactoryArgs): Transport {
  const { url, headers, transport, fetch: customFetch } = args;
  const requestInit: RequestInit = { headers };
  if (transport === "sse") {
    return new SSEClientTransport(url, {
      requestInit,
      eventSourceInit: requestInit as never,
      fetch: customFetch,
    });
  }
  return new StreamableHTTPClientTransport(url, {
    requestInit,
    fetch: customFetch,
  });
}

function defaultClientFactory(): Client {
  return new Client({ name: "thinkwork-pi", version: "0.0.0" });
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function exposedToolName(serverName: string, toolName: string): string {
  const fullName = `mcp_${sanitizeName(serverName)}_${sanitizeName(toolName)}`;
  if (fullName.length <= MAX_EXPOSED_TOOL_NAME_LENGTH) return fullName;

  const hash = createHash("sha256")
    .update(fullName)
    .digest("hex")
    .slice(0, TRUNCATED_TOOL_NAME_HASH_LENGTH);
  const prefixLength =
    MAX_EXPOSED_TOOL_NAME_LENGTH - TRUNCATED_TOOL_NAME_HASH_LENGTH - 1;
  return `${fullName.slice(0, prefixLength)}_${hash}`;
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function schemaFor(schema: unknown): TSchema {
  if (
    schema &&
    typeof schema === "object" &&
    (schema as { type?: unknown }).type === "object"
  ) {
    return schema as TSchema;
  }
  return Type.Object({});
}

function textFromMcpContent(content: unknown): string {
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

type McpAppDescriptor = {
  uri: string;
  mimeType: "text/html";
  html: string;
  title?: string;
  serverName: string;
  toolName: string;
};

function mcpAppsFromContent(input: {
  content: unknown;
  serverName: string;
  toolName: string;
}): McpAppDescriptor[] {
  if (!Array.isArray(input.content)) return [];
  return input.content
    .map((item) => {
      const record =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
      const resource = record?.resource;
      const resourceRecord =
        resource && typeof resource === "object"
          ? (resource as Record<string, unknown>)
          : record;
      if (!resourceRecord) return null;
      const uri = resourceRecord.uri;
      const mimeType = resourceRecord.mimeType;
      const html = resourceRecord.text;
      if (
        typeof uri !== "string" ||
        typeof html !== "string" ||
        !isHtmlMimeType(mimeType)
      ) {
        return null;
      }
      return {
        uri,
        mimeType: "text/html" as const,
        html,
        title: titleFromHtml(html) ?? input.toolName,
        serverName: input.serverName,
        toolName: input.toolName,
      };
    })
    .filter((app): app is NonNullable<typeof app> => app !== null);
}

function mcpAppsFromReadResource(input: {
  response: unknown;
  serverName: string;
  toolName: string;
}): McpAppDescriptor[] {
  const record =
    input.response && typeof input.response === "object"
      ? (input.response as Record<string, unknown>)
      : null;
  const contents = Array.isArray(record?.contents) ? record.contents : [];
  return contents
    .map((item) => {
      const resource =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
      if (!resource) return null;
      const uri = resource.uri;
      const mimeType = resource.mimeType;
      const html = resource.text;
      if (
        typeof uri !== "string" ||
        typeof html !== "string" ||
        !isHtmlMimeType(mimeType)
      ) {
        return null;
      }
      return {
        uri,
        mimeType: "text/html" as const,
        html,
        title: titleFromHtml(html) ?? input.toolName,
        serverName: input.serverName,
        toolName: input.toolName,
      };
    })
    .filter((app): app is NonNullable<typeof app> => app !== null);
}

function mcpAppTemplateUris(response: unknown): string[] {
  const record =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const meta =
    record._meta && typeof record._meta === "object"
      ? (record._meta as Record<string, unknown>)
      : {};
  const ui =
    meta.ui && typeof meta.ui === "object"
      ? (meta.ui as Record<string, unknown>)
      : {};
  const candidates = [
    meta["openai/outputTemplate"],
    meta["ui/resourceUri"],
    ui.resourceUri,
  ];
  const uris: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    if (uris.includes(candidate)) continue;
    uris.push(candidate);
  }
  return uris;
}

async function mcpAppsFromTemplateResources(input: {
  client: Client;
  response: unknown;
  serverName: string;
  toolName: string;
  timeoutMs: number;
}): Promise<McpAppDescriptor[]> {
  const apps: McpAppDescriptor[] = [];
  for (const uri of mcpAppTemplateUris(input.response)) {
    try {
      const resource = await input.client.readResource(
        { uri },
        { timeout: input.timeoutMs },
      );
      apps.push(
        ...mcpAppsFromReadResource({
          response: resource,
          serverName: input.serverName,
          toolName: input.toolName,
        }),
      );
    } catch {
      // Tool calls remain useful even when a server advertises a stale or
      // unavailable MCP App resource URI.
    }
  }
  return apps;
}

function isHtmlMimeType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.split(";", 1)[0].trim().toLowerCase() === "text/html"
  );
}

function titleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Build a `ConnectMcpServerFn` that the trusted handler injects into
 * `buildMcpTools`. The resulting function is a thin adapter — given
 * `{ url, headers, serverName, toolWhitelist?, transport? }`, it connects,
 * lists tools, and returns AgentTool[]. Each tool's execute closure calls
 * the MCP server's `callTool` RPC. A failure during connect / list bubbles
 * out so `buildMcpTools` can surface it via `onConnectError`.
 */
export function createConnectMcpServer(
  options: CreateConnectMcpServerOptions,
): ConnectMcpServerFn {
  const cleanupQueue = options.cleanup;
  const listToolsTimeoutMs =
    options.listToolsTimeoutMs ?? DEFAULT_LIST_TOOLS_TIMEOUT_MS;
  const callToolTimeoutMs =
    options.callToolTimeoutMs ?? DEFAULT_CALL_TOOL_TIMEOUT_MS;
  const readResourceTimeoutMs =
    options.readResourceTimeoutMs ?? DEFAULT_READ_RESOURCE_TIMEOUT_MS;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const longCallMaxTotalTimeoutMs =
    options.longCallMaxTotalTimeoutMs ?? DEFAULT_LONG_CALL_MAX_TOTAL_TIMEOUT_MS;
  const transportFactory = options.transportFactory ?? defaultTransportFactory;
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const customFetch = options.fetch;
  const retention = options.retention;

  return async function connectMcpServer(
    args: ConnectMcpServerArgs,
  ): Promise<AgentTool<any>[]> {
    const url = new URL(args.url);
    const initialAuthorization = args.headers.Authorization ?? null;
    const fetchState: IndirectFetchState | null = retention
      ? { fetch: customFetch, authorization: initialAuthorization }
      : null;
    const transport = transportFactory({
      url,
      headers: args.headers,
      transport: args.transport ?? "streamable-http",
      fetch: fetchState ? makeIndirectFetch(fetchState) : customFetch,
    });
    const client = clientFactory();
    await client.connect(transport, { timeout: connectTimeoutMs });

    // THINK-623 — servers that stream MCP progress notifications during a
    // long tool call opt into a per-attempt wall that RESETS on every
    // notification, bounded by an absolute `maxTotalTimeout`. Every other
    // server keeps the single fixed `timeout` (and no `onprogress`, so the
    // SDK sends no `progressToken`) — byte-identical to the legacy path.
    const callToolOptions: RequestOptions = args.longRunning
      ? {
          timeout: callToolTimeoutMs,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: longCallMaxTotalTimeoutMs,
          onprogress: noteMcpProgress,
        }
      : { timeout: callToolTimeoutMs };

    const closeTransport = async () => {
      try {
        await transport.close();
      } catch {
        // The trusted handler logs cleanup failures via its structured
        // logger; throwing here would mask the real error from the agent
        // loop.
      }
    };
    if (retention && fetchState) {
      // Warm-cache retention (U7): the connection outlives the turn; the
      // per-turn cleanup drain must not tear it down. Eviction closes it.
      retention.register({
        serverName: args.serverName,
        ping: (opts) => client.ping(opts),
        close: closeTransport,
        setFetch: (fetchImpl) => {
          fetchState.fetch = fetchImpl;
        },
        setAuthorization: (value) => {
          fetchState.authorization = value;
        },
        hasAuthorization: initialAuthorization !== null,
      });
    } else {
      cleanupQueue.push(closeTransport);
    }

    const listing = await client.listTools(undefined, {
      timeout: listToolsTimeoutMs,
    });
    const allowlist = args.toolWhitelist?.length
      ? new Set(args.toolWhitelist)
      : null;
    return listing.tools
      .filter((tool) => !allowlist || allowlist.has(tool.name))
      .map((tool): AgentTool<any> => {
        // Plan §006 U4 — populate the per-invocation registry from the
        // SAME post-whitelist-filter loop that builds AgentTools. The
        // proxy AgentTool reads this registry for list/search/call;
        // populating AFTER the filter preserves the operator's
        // toolWhitelist contract (tools the operator hid cannot be
        // addressed via `mcp.call_tool({ server, tool })`).
        args.registry?.register(args.serverName, {
          tool: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
        });
        const name = exposedToolName(args.serverName, tool.name);
        return {
          name,
          label: `${args.serverName}: ${tool.name}`,
          description: [
            `Call the ${tool.name} MCP tool on ${args.serverName}.`,
            tool.description ?? "",
          ]
            .filter(Boolean)
            .join(" "),
          parameters: schemaFor(tool.inputSchema),
          executionMode: "sequential",
          execute: async (_toolCallId, params) => {
            const response = await client.callTool(
              {
                name: tool.name,
                arguments: paramsRecord(params),
              },
              undefined,
              callToolOptions,
            );
            const content =
              "content" in response ? response.content : response.toolResult;
            const rawText = textFromMcpContent(content);
            const mcpApps = mcpAppsFromContent({
              content,
              serverName: args.serverName,
              toolName: tool.name,
            });
            mcpApps.push(
              ...(await mcpAppsFromTemplateResources({
                client,
                response,
                serverName: args.serverName,
                toolName: tool.name,
                timeoutMs: readResourceTimeoutMs,
              })),
            );
            if ("isError" in response && response.isError) {
              throw new Error(
                rawText || `MCP tool ${tool.name} returned isError`,
              );
            }
            const text = textFromMcpContent(
              transformMcpResultContent(content, args.resultTransforms),
            );
            const enriched = enrichMcpRecordLinks({
              hints: args.recordLinkHints,
              response,
              text,
              toolName: tool.name,
            });
            return {
              content: [{ type: "text", text: enriched.text }],
              details: {
                server_name: args.serverName,
                mcp_server: args.serverName,
                mcp_tool_name: tool.name,
                exposed_tool_name: name,
                ...(enriched.recordLinks.length > 0
                  ? { recordLinks: enriched.recordLinks }
                  : {}),
                ...(mcpApps.length > 0 ? { mcp_apps: mcpApps } : {}),
                raw: response,
              },
            };
          },
        };
      });
  };
}
