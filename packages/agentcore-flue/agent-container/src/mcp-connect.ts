/**
 * Plan §005 U9 — Real `connectMcpServer` factory.
 *
 * U7 left this slot pluggable so the MCP build path could be tested in
 * isolation. U9 plugs in the production implementation: a thin wrapper around
 * `@modelcontextprotocol/sdk`'s streamable-HTTP / SSE clients that:
 *
 *   - Honors the handle-shaped `Authorization: Handle <uuid>` header U7 mints
 *     (the bearer never appears here — at egress time, U16's worker-thread
 *     `fetch` interceptor swaps `Handle <uuid>` for `Bearer <bearer>` by
 *     consulting the trusted-side HandleStore).
 *   - Surfaces every tool the MCP server exposes (or the optional whitelist)
 *     as a Flue/pi-agent-core `AgentTool<any>`.
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
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "typebox";
import type {
  ConnectMcpServerArgs,
  ConnectMcpServerFn,
} from "./mcp.js";

/** Default per-RPC timeout; matches the legacy pi-mono MCP implementation. */
const DEFAULT_LIST_TOOLS_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TOOL_TIMEOUT_MS = 60_000;

export interface CreateConnectMcpServerOptions {
  /** Cleanup queue the trusted handler drains on completion. */
  cleanup: Array<() => Promise<void>>;
  /** Override `listTools` timeout (default 30s). */
  listToolsTimeoutMs?: number;
  /** Override `callTool` timeout (default 60s). */
  callToolTimeoutMs?: number;
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
}

export interface TransportFactoryArgs {
  url: URL;
  headers: Record<string, string>;
  transport: "streamable-http" | "sse";
}

function defaultTransportFactory(args: TransportFactoryArgs): Transport {
  const { url, headers, transport } = args;
  const requestInit: RequestInit = { headers };
  if (transport === "sse") {
    return new SSEClientTransport(url, {
      requestInit,
      eventSourceInit: requestInit as never,
    });
  }
  return new StreamableHTTPClientTransport(url, { requestInit });
}

function defaultClientFactory(): Client {
  return new Client({ name: "thinkwork-flue", version: "0.0.0" });
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function exposedToolName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeName(serverName)}_${sanitizeName(toolName)}`.slice(0, 64);
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
  const transportFactory =
    options.transportFactory ?? defaultTransportFactory;
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  return async function connectMcpServer(
    args: ConnectMcpServerArgs,
  ): Promise<AgentTool<any>[]> {
    const url = new URL(args.url);
    const transport = transportFactory({
      url,
      headers: args.headers,
      transport: args.transport ?? "streamable-http",
    });
    const client = clientFactory();
    await client.connect(transport);

    cleanupQueue.push(async () => {
      try {
        await transport.close();
      } catch {
        // The trusted handler logs cleanup failures via its structured
        // logger; throwing here would mask the real error from the agent
        // loop.
      }
    });

    const listing = await client.listTools(undefined, {
      timeout: listToolsTimeoutMs,
    });
    const allowlist = args.toolWhitelist?.length
      ? new Set(args.toolWhitelist)
      : null;
    return listing.tools
      .filter((tool) => !allowlist || allowlist.has(tool.name))
      .map((tool): AgentTool<any> => {
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
              { timeout: callToolTimeoutMs },
            );
            const content =
              "content" in response ? response.content : response.toolResult;
            const text = textFromMcpContent(content);
            if ("isError" in response && response.isError) {
              throw new Error(text || `MCP tool ${tool.name} returned isError`);
            }
            return {
              content: [{ type: "text", text }],
              details: {
                server_name: args.serverName,
                mcp_server: args.serverName,
                mcp_tool_name: tool.name,
                exposed_tool_name: name,
                raw: response,
              },
            };
          },
        };
      });
  };
}
