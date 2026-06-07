import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  assertModelRouteApproved,
  findModelRoutingDecision,
  ModelRoutingPolicyError,
  type ChildModelCaller,
  type ModelRoutingDecision,
  type ModelRoutingPolicy,
} from "@thinkwork/pi-runtime-core";
import type { McpToolRegistry } from "./mcp-registry.js";

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
 *   inert ship; U9 wires the real Pi / `@modelcontextprotocol/sdk`
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
  /**
   * Plan §006 U2/U4 — per-invocation registry the connect path populates
   * with each whitelist-filtered tool's metadata. The MCP proxy AgentTool
   * (U3) reads from this registry for its list/search modes; the proxy's
   * `call` mode (U5) reads from it to validate before dispatching.
   *
   * **Security invariant:** registry population happens AFTER the per-server
   * `toolWhitelist` filter. Tools the operator hid via the whitelist must
   * not appear in the registry — otherwise the proxy's call mode would be
   * able to address them. The production factory (`createConnectMcpServer`
   * in `mcp-connect.ts`) honours this ordering; any alternative connect
   * implementation must as well.
   *
   * Optional so existing tests that pass fakes don't need updating; the
   * fake simply ignores the field and the new tests in U4 supply their
   * own fakes that exercise the registry-population path explicitly.
   */
  registry?: McpToolRegistry;
}

/**
 * Connect to an MCP server and return its `AgentTool[]`. U9 supplies
 * the real implementation. Pi does not ship native MCP-server support,
 * so ThinkWork bridges MCP configs into Pi `AgentTool[]` here. This keeps
 * the runtime compatible with the existing per-user OAuth/MCP payloads
 * while leaving room to evaluate `pi-mcp-adapter` for a lean proxy-tool
 * surface once the filesystem runtime canary is running.
 */
export type ConnectMcpServerFn = (
  args: ConnectMcpServerArgs,
) => Promise<AgentTool<any>[]>;

export interface McpAgentToolIdentity {
  serverName: string;
  toolName: string;
}

const mcpAgentToolIdentities = new WeakMap<
  AgentTool<any>,
  McpAgentToolIdentity
>();

export function getMcpAgentToolIdentity(
  tool: AgentTool<any>,
): McpAgentToolIdentity | null {
  return mcpAgentToolIdentities.get(tool) ?? null;
}

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
// buildMcpTools — Pi-shaped wiring with handle-shaped auth.
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
   * Connect factory. **Required** — U9 must inject either Pi's
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
  /**
   * Plan §006 U4 — per-invocation registry forwarded to each per-server
   * `connectMcpServer` call so the production factory can populate it
   * inside the same toolWhitelist-filter loop that builds the AgentTools.
   * The proxy AgentTool reads from this registry for list/search/call.
   * Omit to retain the legacy "AgentTools-only, no registry" behavior.
   */
  registry?: McpToolRegistry;
  /** Optional TOOLS.md policy for wrapping matched MCP tools in child-model work. */
  modelRoutingPolicy?: ModelRoutingPolicy;
  approvedModelIds?: string[];
  childModelCaller?: ChildModelCaller;
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringMatchValues(value: unknown): Record<string, string> {
  const record = recordValue(value);
  if (!record) return {};
  const match: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      match[key] = String(raw).trim();
    }
  }
  return match;
}

function mcpToolRouteMatch(input: {
  serverName: string;
  toolName: string;
  params: unknown;
}): Record<string, string> {
  const paramMatch = stringMatchValues(input.params);
  return {
    serverName: input.serverName,
    mcpServer: input.serverName,
    tool: input.toolName,
    toolName: input.toolName,
    ...paramMatch,
  };
}

const MCP_SERVER_MODEL_ROUTING_TOOL = "mcp";

function modelRoutingDecisionRank(decision: ModelRoutingDecision): {
  specificity: number;
  precedence: number;
  exactTool: number;
} {
  return {
    specificity: Object.keys(decision.route.match).length,
    precedence: decision.route.precedence ?? 0,
    exactTool: decision.route.tool === MCP_SERVER_MODEL_ROUTING_TOOL ? 0 : 1,
  };
}

function compareModelRoutingDecisions(
  left: ModelRoutingDecision,
  right: ModelRoutingDecision,
): number {
  const leftRank = modelRoutingDecisionRank(left);
  const rightRank = modelRoutingDecisionRank(right);
  return (
    rightRank.specificity - leftRank.specificity ||
    rightRank.precedence - leftRank.precedence ||
    rightRank.exactTool - leftRank.exactTool
  );
}

function findMcpModelRoutingDecision(
  policy: ModelRoutingPolicy,
  input: { toolName: string; match: Record<string, string> },
): ModelRoutingDecision | null {
  const decisions = [
    findModelRoutingDecision(policy, {
      toolName: MCP_SERVER_MODEL_ROUTING_TOOL,
      match: input.match,
    }),
    findModelRoutingDecision(policy, input),
  ].filter((decision): decision is ModelRoutingDecision => Boolean(decision));
  if (!decisions.length) return null;
  return [...decisions].sort(compareModelRoutingDecisions)[0]!;
}

function childModelPrompt(input: {
  toolName: string;
  params: unknown;
  result: unknown;
}): string {
  return [
    `MCP tool: ${input.toolName}`,
    "",
    "Tool parameters:",
    JSON.stringify(input.params ?? {}, null, 2),
    "",
    "Raw tool result:",
    JSON.stringify(input.result ?? {}, null, 2),
  ].join("\n");
}

function routedMcpResult(input: {
  originalResult: unknown;
  childText: string;
  decision: ModelRoutingDecision;
  toolCallId: string;
  toolName: string;
  match: Record<string, string>;
  durationMs: number;
  usage?: Awaited<ReturnType<ChildModelCaller>>["usage"];
  stopReason?: string;
}) {
  const original = recordValue(input.originalResult);
  const originalDetails = recordValue(original?.details);
  return {
    content: [{ type: "text" as const, text: input.childText }],
    details: {
      ...(originalDetails ?? {}),
      rawToolResult: input.originalResult,
      modelRouting: {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        match: input.match,
        model: input.decision.route.model,
        ruleSource: input.decision.ruleSource,
        status: "completed",
        durationMs: input.durationMs,
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
        ...(input.usage
          ? {
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
              cachedReadTokens: input.usage.cachedReadTokens,
              cachedWriteTokens: input.usage.cachedWriteTokens,
              totalTokens: input.usage.totalTokens,
            }
          : {}),
      },
    },
  };
}

function wrapMcpToolForModelRouting(input: {
  tool: AgentTool<any>;
  serverName: string;
  modelRoutingPolicy: ModelRoutingPolicy;
  approvedModelIds: string[];
  childModelCaller?: ChildModelCaller;
}): AgentTool<any> {
  const { tool, serverName, modelRoutingPolicy, approvedModelIds } = input;
  const wrapped: AgentTool<any> = {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      if (modelRoutingPolicy.routes.length === 0) {
        return tool.execute(toolCallId, params, signal, onUpdate);
      }
      const match = mcpToolRouteMatch({
        serverName,
        toolName: tool.name,
        params,
      });
      const decision = findMcpModelRoutingDecision(modelRoutingPolicy, {
        toolName: tool.name,
        match,
      });
      if (!decision) {
        return tool.execute(toolCallId, params, signal, onUpdate);
      }

      assertModelRouteApproved({ decision, approvedModelIds });
      if (!input.childModelCaller) {
        throw new ModelRoutingPolicyError(
          "MODEL_ROUTE_CALLER_MISSING",
          `TOOLS.md routed ${tool.name} to model "${decision.route.model}", but no child model caller is configured.`,
          decision.route,
        );
      }

      const originalResult = await tool.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
      );
      const startedAt = Date.now();
      const childResult = await input.childModelCaller({
        modelId: decision.route.model,
        systemPrompt:
          "You are a ThinkWork MCP tool execution helper. Use the raw MCP tool result to produce the concise useful result for the parent agent.",
        prompt: childModelPrompt({
          toolName: tool.name,
          params,
          result: originalResult,
        }),
        metadata: {
          toolName: tool.name,
          sourcePath: decision.ruleSource.path,
          sourceOwner: decision.ruleSource.owner,
          mcpServer: serverName,
        },
      });
      return routedMcpResult({
        originalResult,
        childText: childResult.text,
        decision,
        toolCallId,
        toolName: tool.name,
        match,
        durationMs: Date.now() - startedAt,
        usage: childResult.usage,
        stopReason: childResult.stopReason,
      });
    },
  };
  mcpAgentToolIdentities.set(wrapped, {
    serverName,
    toolName: tool.name,
  });
  return wrapped;
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
  const {
    mcpConfigs,
    handleStore,
    connectMcpServer,
    onConnectError,
    registry,
    modelRoutingPolicy = { routes: [] },
    approvedModelIds = [],
    childModelCaller,
  } = options;

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
        registry,
      });
      tools.push(
        ...serverTools.map((tool) =>
          wrapMcpToolForModelRouting({
            tool,
            serverName: config.serverName,
            modelRoutingPolicy,
            approvedModelIds,
            childModelCaller,
          }),
        ),
      );
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
