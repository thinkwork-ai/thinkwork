import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";

/**
 * Plan §005 U7 — MCP wiring with handle-shaped Authorization.
 *
 * Per FR-3a, per-user OAuth bearer tokens must never be serialized into
 * `ToolDef` objects passed to `init({ tools })`. Bearers stay in the
 * trusted-handler closure as values in a `Map<TokenHandle, OAuthBearer>`;
 * the `Authorization` header that crosses into the worker thread carries
 * an opaque handle (UUIDv4) under a custom `Handle ` scheme.
 *
 * U7 owns:
 * - `HandleStore`: mint/resolve/revoke/clear lifecycle.
 * - `buildMcpTools`: per-config handle minting + delegation to a
 *   pluggable `connectMcpServer` factory (defaults to no-op for U7's
 *   inert ship; U9 wires the real Flue / `@modelcontextprotocol/sdk`
 *   client at handler entry).
 * - The serialization contract (no bearer in `JSON.stringify(toolDefs)`).
 *
 * U16 owns the egress side:
 * - Custom `fetch` interception in the worker thread that swaps the
 *   `Handle <id>` header for `Bearer <bearer>` at MCP request time, by
 *   asking the trusted-handler-side `HandleStore` to resolve. The
 *   worker never sees the bearer in process memory.
 * - Response-body scrubbing for any bearer-shaped strings that the
 *   MCP server might echo back.
 *
 * Inert-ship (U7): nothing imports this module yet. U9's handler shell
 * wires it into `init({ tools })`.
 */

// ---------------------------------------------------------------------------
// HandleStore — opaque-handle lifecycle.
// ---------------------------------------------------------------------------

export const McpHandleAuthScheme = "Handle";

export class HandleStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandleStoreError";
  }
}

/**
 * In-memory map from opaque handle (UUIDv4) to OAuth bearer. Lives on
 * the trusted-handler side; the worker thread never sees a bearer.
 *
 * **CRITICAL lifecycle:** Construct a fresh `HandleStore` per
 * invocation in U9, and wrap the entire invocation in
 * `try { … } finally { handleStore.clear() }` so bearers cannot leak
 * across warm-container reuses on AgentCore. Sharing a single
 * `HandleStore` across invocations is a tenant-isolation violation —
 * the same handle would resolve to whichever bearer was minted most
 * recently, regardless of which invocation supplied it.
 */
export class HandleStore {
  private readonly map = new Map<string, string>();

  /** Returns a fresh handle for `bearer`. */
  mint(bearer: string): string {
    if (typeof bearer !== "string") {
      throw new HandleStoreError(
        "HandleStore.mint requires a string bearer; received non-string.",
      );
    }
    const trimmed = bearer.trim();
    if (!trimmed) {
      throw new HandleStoreError(
        "HandleStore.mint requires a non-empty bearer.",
      );
    }
    // CRLF / null-byte guard: HTTP header values cannot legally carry
    // CR, LF, or NUL. A malformed bearer with these characters could
    // become a header-injection vector at egress time. Bearers from
    // OAuth servers should never contain these; rejecting at mint
    // surfaces upstream corruption rather than producing a malformed
    // wire payload downstream.
    if (/[\r\n\0]/.test(bearer)) {
      throw new HandleStoreError(
        "HandleStore.mint refuses bearers containing CR, LF, or NUL.",
      );
    }
    const handle = randomUUID();
    this.map.set(handle, bearer);
    return handle;
  }

  /** Returns the bearer for `handle`. Throws when the handle is not live. */
  resolve(handle: string): string {
    const bearer = this.map.get(handle);
    if (bearer === undefined) {
      throw new HandleStoreError(`HandleStore: handle not found.`);
    }
    return bearer;
  }

  /** Removes `handle` from the store. No-op when the handle is unknown. */
  revoke(handle: string): void {
    this.map.delete(handle);
  }

  /** Drops every minted handle. Call from the trusted handler on completion. */
  clear(): void {
    this.map.clear();
  }

  /** Number of live handles. Diagnostic only. */
  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// connectMcpServer — pluggable factory.
// ---------------------------------------------------------------------------

export interface ConnectMcpServerArgs {
  /** Absolute URL of the MCP server endpoint. */
  url: string;
  /**
   * Headers to send on every MCP request, including `Authorization`
   * shaped as `Handle <id>` per FR-3a. The bearer is NOT in here.
   */
  headers: Record<string, string>;
  /**
   * Server-side display name for the MCP server. Used to namespace
   * tool names so two servers exposing `search` don't collide.
   */
  serverName: string;
  /** Optional whitelist of tool names to surface from this server. */
  toolWhitelist?: string[];
  /** Optional transport hint. Defaults to streamable-http. */
  transport?: "streamable-http" | "sse";
}

/**
 * Connect to an MCP server and return its `AgentTool[]`. U9 supplies
 * the real implementation — either Flue's `connectMcpServer` (once
 * `@flue/sdk` is added) or a thin adapter around
 * `@modelcontextprotocol/sdk` mirroring the legacy pi-mono code at
 * `runtime/tools/mcp.ts`.
 */
export type ConnectMcpServerFn = (
  args: ConnectMcpServerArgs,
) => Promise<AgentTool<any>[]>;

/**
 * Optional callback fired when a per-server connect throws. U9 wires
 * structured logging through this seam without re-opening U7. Returns
 * void; throwing here aborts the entire build.
 */
export type ConnectMcpServerErrorFn = (
  err: unknown,
  config: McpServerConfig,
) => void;

// ---------------------------------------------------------------------------
// buildMcpTools — Flue-shaped wiring with handle-shaped auth.
// ---------------------------------------------------------------------------

export interface McpServerConfig {
  /** Display name; namespaces tool names. */
  serverName: string;
  /** MCP server endpoint URL. */
  url: string;
  /**
   * OAuth bearer for this server, scoped to the invoking user. The
   * bearer is consumed at handle-mint time and never propagated past
   * the trusted handler.
   */
  bearer: string;
  /**
   * Extra request headers (e.g. API version pins). The Authorization
   * header is always overwritten with the handle-shaped value, so any
   * caller-supplied Authorization is silently dropped.
   */
  extraHeaders?: Record<string, string>;
  /** Optional tool-name whitelist (forwarded to the MCP client). */
  toolWhitelist?: string[];
  /** Transport hint. Defaults to streamable-http. */
  transport?: "streamable-http" | "sse";
}

export interface BuildMcpToolsOptions {
  mcpConfigs: McpServerConfig[];
  handleStore: HandleStore;
  /**
   * Connect factory. **Required** — U9 must inject either Flue's
   * `connectMcpServer` or a thin adapter around
   * `@modelcontextprotocol/sdk`. Tests pass a fake to capture the
   * headers passed to the connect call.
   *
   * U7 deliberately has no default: a forgotten injection should fail
   * the typecheck rather than silently produce zero MCP tools at
   * runtime.
   */
  connectMcpServer: ConnectMcpServerFn;
  /**
   * Optional callback fired when a per-server connect throws. U9 wires
   * structured logging here. The other servers continue regardless.
   */
  onConnectError?: ConnectMcpServerErrorFn;
}

/**
 * HTTP header keys whose presence in `extraHeaders` would override
 * the handle-shaped Authorization at the wire level. HTTP header names
 * are case-insensitive, so a caller-supplied lowercase `authorization`
 * key would coexist with the handle-shaped `Authorization` in a plain
 * JS object — and downstream HTTP clients may pick whichever they see
 * first. Strip any header whose lowercase form matches before merging.
 */
const FORBIDDEN_AUTH_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
]);

function normaliseExtraHeaders(
  extra: Record<string, string> | undefined,
): Record<string, string> {
  if (!extra) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (FORBIDDEN_AUTH_HEADER_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Build the MCP tool surface for one invocation. Per server: mint a
 * handle from the bearer, build the handle-shaped Authorization
 * header, call `connectMcpServer`, collect ToolDefs. A failure on one
 * server does not block the others; failed servers' handles are
 * revoked so the store doesn't accumulate dead entries.
 */
export async function buildMcpTools(
  options: BuildMcpToolsOptions,
): Promise<AgentTool<any>[]> {
  const { mcpConfigs, handleStore, connectMcpServer, onConnectError } = options;

  const tools: AgentTool<any>[] = [];
  for (const config of mcpConfigs) {
    if (
      !config?.serverName ||
      !config.url ||
      typeof config.bearer !== "string" ||
      !config.bearer.trim()
    ) {
      // Skip incomplete configs rather than crashing the entire build.
      // Whitespace-only bearers are rejected here so they don't reach
      // HandleStore.mint (which throws — that throw would bubble out
      // and kill the entire MCP build for one bad config).
      continue;
    }

    let handle: string;
    try {
      handle = handleStore.mint(config.bearer);
    } catch (err) {
      // Bearer rejected by HandleStore (CRLF / NUL injection guard).
      // Skip this server; surface the error through the callback so
      // U9 can log it without aborting the build for the others.
      onConnectError?.(err, config);
      continue;
    }

    const headers: Record<string, string> = {
      ...normaliseExtraHeaders(config.extraHeaders),
      // Always overwrite Authorization — even if the caller supplied a
      // Bearer token in extraHeaders, it must NEVER reach the connect
      // call. The handle scheme is the only auth that crosses.
      Authorization: `${McpHandleAuthScheme} ${handle}`,
    };

    try {
      const serverTools = await connectMcpServer({
        url: config.url,
        headers,
        serverName: config.serverName,
        toolWhitelist: config.toolWhitelist,
        transport: config.transport,
      });
      tools.push(...serverTools);
    } catch (err) {
      // Failed connect: revoke the handle so we don't leak it across
      // invocations. Surface the error through onConnectError so U9
      // can log it. The agent loses one MCP server's tools but the
      // rest of the turn proceeds.
      handleStore.revoke(handle);
      onConnectError?.(err, config);
    }
  }

  return tools;
}
