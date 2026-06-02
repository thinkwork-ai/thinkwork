// mcp-tools — bounded Pi-style MCP gateway retained for compatibility tests.
//
// Mobile does not run MCP transports inside Hermes. The device gets one model-visible
// `mcp` tool; ThinkWork resolves tenant servers and per-user bearer/OAuth server-side.

import {
  McpProxyClientError,
  callTenantMcpTool,
  callTenantTool,
  listTenantToolCatalog,
  listTenantTools,
  tenantToolContentToText,
  type TenantMcpDeps,
  type TenantToolDef,
  type TenantToolListError,
  type TenantToolListResult,
  type TenantToolResult,
} from "../../mcp-client";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { JsonSchema, Tool, ToolResult } from "../types";

export interface McpToolsExtensionOptions {
  /** The thread's agent — selects which tenant MCP servers to expose (U2 proxy key). */
  agentId: string;
  /**
   * Optional escape hatch for compact/high-value direct tools. Default mobile behavior
   * exposes only the bounded `mcp` gateway.
   */
  directToolAllowlist?: readonly string[];
  /** Injected for tests: token resolution / fetch / apiBase, plus the proxy fns. */
  deps?: TenantMcpDeps & {
    listCatalog?: typeof listTenantToolCatalog;
    listTools?: typeof listTenantTools;
    callMcpTool?: typeof callTenantMcpTool;
    callTool?: typeof callTenantTool;
  };
}

const MCP_TOOL_PARAMETERS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Provide exactly one of list, search, or call. includeSchemas is optional for list/search.",
  properties: {
    list: {
      type: "boolean",
      description: "When true, return the catalog of available MCP tools.",
    },
    search: {
      type: "string",
      description:
        "Substring to match against MCP server, tool name, and description.",
    },
    call: {
      type: "object",
      description: "Dispatch to one MCP tool returned by list/search.",
      properties: {
        server: {
          type: "string",
          description: "MCP server slug returned by list/search.",
        },
        tool: {
          type: "string",
          description: "MCP tool name returned by list/search.",
        },
        args: {
          type: "object",
          description: "Arguments object passed to the MCP tool.",
          additionalProperties: true,
        },
      },
      required: ["server", "tool"],
    },
    includeSchemas: {
      type: "boolean",
      description:
        "When true, include inputSchema for list/search results. Defaults false.",
    },
  },
};

function toParameters(inputSchema: unknown): JsonSchema {
  if (inputSchema && typeof inputSchema === "object") {
    const schema = inputSchema as JsonSchema;
    return schema.type ? schema : { ...schema, type: "object" };
  }
  return { type: "object" };
}

function splitQualifiedName(
  name: string,
): { server: string; tool: string } | null {
  const idx = name.indexOf("__");
  if (idx <= 0) return null;
  return {
    server: name.slice(0, idx),
    tool: name.slice(idx + 2),
  };
}

function toolServer(def: TenantToolDef): string {
  return def.server ?? splitQualifiedName(def.name)?.server ?? "default";
}

function toolName(def: TenantToolDef): string {
  return def.tool ?? splitQualifiedName(def.name)?.tool ?? def.name;
}

function toolMatches(def: TenantToolDef, query: string): boolean {
  const q = query.toLowerCase();
  return [def.name, toolServer(def), toolName(def), def.description ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function directAllowlistMatches(
  def: TenantToolDef,
  allowlist: ReadonlySet<string>,
): boolean {
  return (
    allowlist.has(def.name) ||
    allowlist.has(toolName(def)) ||
    allowlist.has(`${toolServer(def)}__${toolName(def)}`) ||
    allowlist.has(`${toolServer(def)}.${toolName(def)}`)
  );
}

function catalogText(
  catalog: TenantToolListResult,
  options: { search?: string; includeSchemas?: boolean } = {},
): string {
  const tools = catalog.tools
    .filter((def) => (options.search ? toolMatches(def, options.search) : true))
    .map((def) => ({
      server: toolServer(def),
      tool: toolName(def),
      name: def.name,
      description: def.description ?? "",
      ...(options.includeSchemas ? { inputSchema: def.inputSchema } : {}),
    }));
  return JSON.stringify(
    {
      tools,
      errors: catalog.errors,
    },
    null,
    2,
  );
}

function modeCount(args: Record<string, unknown>): number {
  return [
    args.list === true,
    typeof args.search === "string",
    !!args.call,
  ].filter(Boolean).length;
}

function recordArg(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatProxyError(operation: string, err: unknown): ToolResult {
  if (err instanceof McpProxyClientError) {
    if (err.kind === "auth") {
      return {
        content:
          `${operation} failed: MCP authentication is unavailable or expired. ` +
          "Reconnect the connector in ThinkWork, then retry.",
        isError: true,
      };
    }
    if (err.kind === "transport") {
      return {
        content: `${operation} failed: MCP transport error. ${err.message}`,
        isError: true,
      };
    }
  }
  return {
    content: `${operation} failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
    isError: true,
  };
}

function codeExecutionGuidance(toolDefs: TenantToolDef[]): string {
  const available = new Set(toolDefs.map((def) => toolName(def).toLowerCase()));
  const hasBash = available.has("bash") || available.has("shell");
  const hasExecuteCode =
    available.has("execute_code") || available.has("code_interpreter");
  if (!hasBash && !hasExecuteCode) return "";

  const lines = [
    "Some connected MCP tools can execute code or shell commands.",
    hasBash
      ? "Use MCP bash/shell tools for command output, repository work, package scripts, builds, and tests when the user asks for them."
      : "",
    hasExecuteCode
      ? "Use MCP execute_code/code-interpreter tools for isolated Python, calculations, and data analysis."
      : "",
    "Do not calculate code results mentally or claim command output unless the result came from the tool.",
  ].filter(Boolean);
  return `\n\n${lines.join(" ")}`;
}

function discoveryErrorGuidance(
  errors: readonly TenantToolListError[],
): string {
  if (errors.length === 0) return "";
  return ` ${errors.length} MCP server(s) could not be discovered; use \`mcp({ list: true })\` to see the available catalog and errors.`;
}

export function mcpToolsExtension(
  options: McpToolsExtensionOptions,
): ExtensionFactory {
  const { agentId } = options;
  const deps = options.deps ?? {};
  const listCatalog =
    deps.listCatalog ??
    (async (id: string, injected: TenantMcpDeps) => ({
      tools: deps.listTools
        ? await deps.listTools(id, injected)
        : await listTenantTools(id, injected),
      errors: [],
    }));
  const callMcpTool = deps.callMcpTool ?? callTenantMcpTool;
  const callDirectTool = deps.callTool ?? callTenantTool;
  let catalogPromise: Promise<TenantToolListResult> | null = null;

  const loadCatalog = () => {
    catalogPromise ??= listCatalog(agentId, deps).catch((err) => {
      catalogPromise = null;
      throw err;
    });
    return catalogPromise;
  };

  const mcpTool: Tool = {
    name: "mcp",
    description:
      "Gateway to the agent's connected MCP tools. Use list/search to discover tools, then call with { server, tool, args }. Credentials are resolved server-side; never ask for bearer tokens.",
    parameters: MCP_TOOL_PARAMETERS,
    execute: async (args) => {
      if (modeCount(args) !== 1) {
        return {
          content:
            "Provide exactly one MCP mode: { list: true }, { search: string }, or { call: { server, tool, args } }.",
          isError: true,
        };
      }

      if (args.list === true || typeof args.search === "string") {
        try {
          const catalog = await loadCatalog();
          return {
            content: catalogText(catalog, {
              search: typeof args.search === "string" ? args.search : undefined,
              includeSchemas: args.includeSchemas === true,
            }),
            isError: catalog.errors.length > 0,
          };
        } catch (err) {
          return formatProxyError("MCP discovery", err);
        }
      }

      const call = recordArg(args.call);
      const server = typeof call.server === "string" ? call.server.trim() : "";
      const tool = typeof call.tool === "string" ? call.tool.trim() : "";
      if (!server || !tool) {
        return {
          content:
            "MCP call requires { call: { server: string, tool: string, args?: object } }.",
          isError: true,
        };
      }

      try {
        const result = await callMcpTool(
          agentId,
          { server, tool, args: recordArg(call.args) },
          deps,
        );
        return {
          content: tenantToolContentToText(result.content),
          isError: result.isError === true,
        };
      } catch (err) {
        return formatProxyError(`MCP call ${server}/${tool}`, err);
      }
    },
  };

  return defineExtension({
    name: "mcp-tools",
    description: "Exposes connected MCP tools through one bounded gateway.",
    async register(pi) {
      pi.registerTool(mcpTool);

      const directAllowlist = options.directToolAllowlist?.length
        ? new Set(options.directToolAllowlist)
        : null;
      let catalog: TenantToolListResult | null = null;

      if (directAllowlist) {
        try {
          catalog = await loadCatalog();
        } catch (err) {
          pi.logger.warn(
            `mcp-tools: tools/list failed; direct MCP tools disabled: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        for (const def of catalog?.tools ?? []) {
          if (!def.name || !directAllowlistMatches(def, directAllowlist)) {
            continue;
          }
          pi.registerTool({
            name: def.name,
            description: def.description ?? def.name,
            parameters: toParameters(def.inputSchema),
            execute: async (args) => {
              try {
                let result: TenantToolResult;
                const server =
                  def.server ?? splitQualifiedName(def.name)?.server;
                const tool = def.tool ?? splitQualifiedName(def.name)?.tool;
                if (server && tool) {
                  result = await callMcpTool(
                    agentId,
                    { server, tool, args },
                    deps,
                  );
                } else {
                  result = await callDirectTool(agentId, def.name, args, deps);
                }
                return {
                  content: tenantToolContentToText(result.content),
                  isError: result.isError === true,
                };
              } catch (err) {
                return formatProxyError(`MCP call ${def.name}`, err);
              }
            },
          });
        }
      }

      pi.on("before_agent_start", async (e) => {
        let known: TenantToolListResult | null = catalog;
        const names = known?.tools
          .slice(0, 12)
          .map((def) => `${toolServer(def)}/${toolName(def)}`)
          .join(", ");
        return {
          systemPrompt:
            `${e.systemPrompt}\n\nYou have one connected-services gateway tool: \`mcp\`. ` +
            'Use `mcp({ list: true })` to inspect available connected tools, `mcp({ search: "query" })` to narrow them, and `mcp({ call: { server, tool, args } })` to dispatch. ' +
            "ThinkWork resolves MCP credentials server-side; never ask the user for bearer tokens or print secrets." +
            (names ? ` Available MCP tools include: ${names}.` : "") +
            discoveryErrorGuidance(known?.errors ?? []) +
            codeExecutionGuidance(known?.tools ?? []),
        };
      });
    },
  });
}
