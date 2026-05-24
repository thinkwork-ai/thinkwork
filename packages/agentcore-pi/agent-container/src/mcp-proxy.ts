/**
 * Plan §006 U3 — `mcp` proxy AgentTool (inert ship).
 *
 * Single AgentTool that the agent loop sees as `mcp`, exposing three modes:
 *
 *   - `list`:   enumerate all registered MCP tools (optionally with schemas)
 *   - `search`: substring match across tool name + description
 *   - `call`:   dispatch to a `(server, tool, args)` triple
 *
 * The tool replaces today's per-MCP-tool surface (`mcp_<server>_<tool>` —
 * one AgentTool per tool) so the agent's static tool budget stays bounded
 * regardless of how many MCP servers are configured.
 *
 * U3 (this unit) ships the tool registered INERT — `execute()` throws a
 * structured "not yet wired" error. The substrate-first inert→live pattern
 * (docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md,
 * applies to agentcore-pi — flue was the prior name) requires the inert
 * body to THROW, not silently return `{ok: true}` — a silent return would
 * cause the model to reason on a fake successful result.
 *
 * U5 swaps the inert branch for the live body that reads from
 * `McpToolRegistry` (U2) and dispatches through `connectMcpServer` for
 * the `call` mode.
 *
 * Lives in the trusted handler's address space — no worker_thread isolation
 * today — so the registry pointer + HandleStore-bound `connectMcpServer`
 * factory cross no security boundary.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "typebox";
import type { ConnectMcpServerFn } from "./mcp.js";
import type { McpToolRegistry } from "./mcp-registry.js";

export const MCP_PROXY_TOOL_NAME = "mcp";

export type McpProxyMode = "inert" | "live";

const McpProxyParamsSchema = Type.Object(
  {
    list: Type.Optional(
      Type.Boolean({
        description:
          "When true, return the catalog of every available MCP tool (server, tool, description).",
      }),
    ),
    search: Type.Optional(
      Type.String({
        description:
          "Substring (case-insensitive) matched against tool name and description.",
      }),
    ),
    call: Type.Optional(
      Type.Object(
        {
          server: Type.String({
            description:
              "MCP server slug to dispatch to (must be configured).",
          }),
          tool: Type.String({
            description: "MCP tool name as returned by `tools/list`.",
          }),
          args: Type.Object(
            {},
            {
              additionalProperties: true,
              description: "Arguments object passed to the MCP tool.",
            },
          ),
        },
        {
          description: "Dispatch to a configured MCP tool.",
        },
      ),
    ),
    includeSchemas: Type.Optional(
      Type.Boolean({
        description:
          "Applies to list/search. When true, include each tool's input schema.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Provide exactly one of `list`, `search`, or `call`. `includeSchemas` is optional and applies to list/search.",
  },
);

export type McpProxyParams = Static<typeof McpProxyParamsSchema>;

const MCP_PROXY_DESCRIPTION = [
  "Gateway to every configured MCP tool. Use this instead of looking for individual MCP tools.",
  "Modes (provide exactly one):",
  "  - `list: true` -> returns the catalog of available MCP tools.",
  "  - `search: \"query\"` -> substring match against tool name and description.",
  "  - `call: { server, tool, args }` -> dispatches the named tool.",
  "Pass `includeSchemas: true` on list/search to include each tool's input schema.",
].join("\n");

export interface BuildMcpProxyToolOptions {
  /** Inert-first ship discriminator. U3 only handles "inert"; U5 wires "live". */
  mode: McpProxyMode;
  /** Per-invocation registry. Required when mode is "live"; ignored when inert. */
  registry?: McpToolRegistry | null;
  /** Per-invocation MCP client factory. Required when mode is "live"; ignored when inert. */
  connectMcpServer?: ConnectMcpServerFn | null;
}

class McpProxyInertError extends Error {
  constructor() {
    super(
      "MCP proxy is registered but not yet wired (Plan §006 U3). " +
        "Use directTools (mcp.json) for first-class MCP tools in PR-1; " +
        "the live proxy body lands in U5.",
    );
    this.name = "McpProxyInertError";
  }
}

class McpProxyModeUnsupportedError extends Error {
  constructor(mode: string) {
    super(
      `MCP proxy mode "${mode}" is not implemented in Plan §006 U3 ` +
        "(only \"inert\" is shipped in PR-1; \"live\" arrives in U5).",
    );
    this.name = "McpProxyModeUnsupportedError";
  }
}

/**
 * Build the proxy AgentTool. In `mode: "inert"`, `execute()` throws
 * `McpProxyInertError` — the inert-first forcing function: a silent
 * `{ok: true}` would let the model hallucinate a successful tool call.
 */
export function buildMcpProxyTool(
  options: BuildMcpProxyToolOptions,
): AgentTool<any> {
  const { mode } = options;

  return {
    name: MCP_PROXY_TOOL_NAME,
    label: "MCP",
    description: MCP_PROXY_DESCRIPTION,
    parameters: McpProxyParamsSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, _params) => {
      if (mode === "inert") {
        throw new McpProxyInertError();
      }
      // U5 replaces this branch with the live list/search/call dispatcher.
      // The body will narrow `_params` to McpProxyParams (the Static type
      // of McpProxyParamsSchema) and dispatch by discriminator.
      throw new McpProxyModeUnsupportedError(mode);
    },
  };
}

export { McpProxyInertError, McpProxyModeUnsupportedError };
