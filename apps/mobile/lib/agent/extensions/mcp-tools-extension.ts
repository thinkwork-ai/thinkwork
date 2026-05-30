// mcp-tools — the harness's FIRST Pi-style extension.
//
// Mirrors how cloud shipped memory as its first capability: a `defineExtension`
// that, at register time, discovers the agent's tenant MCP tools (via the U2
// proxy, idToken-authed) and registers each as a flat harness Tool, plus a
// `before_agent_start` handler that tells the model it has connected tools.
//
// Failure is non-fatal: if discovery fails (offline, no tenant tools, auth
// hiccup) the extension registers nothing and the turn proceeds as plain chat —
// exactly the "skip a broken server" posture buildMcpConfigs takes server-side.
// This keeps the seam Pi-small: no config system, just registerTool + one hook.

import {
  listTenantTools,
  callTenantTool,
  tenantToolContentToText,
  type TenantMcpDeps,
} from "../../mcp-client";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { JsonSchema, Tool } from "../types";

export interface McpToolsExtensionOptions {
  /** The thread's agent — selects which tenant MCP servers to expose (U2 proxy key). */
  agentId: string;
  /** Injected for tests: token resolution / fetch / apiBase, plus the proxy fns. */
  deps?: TenantMcpDeps & {
    listTools?: typeof listTenantTools;
    callTool?: typeof callTenantTool;
  };
}

/** Coerce the proxy's loose inputSchema into the harness's JsonSchema shape. */
function toParameters(inputSchema: unknown): JsonSchema {
  if (inputSchema && typeof inputSchema === "object") {
    const schema = inputSchema as JsonSchema;
    return schema.type ? schema : { ...schema, type: "object" };
  }
  return { type: "object" };
}

function codeExecutionGuidance(toolNames: string[]): string {
  const available = new Set(toolNames.map((name) => name.toLowerCase()));
  const hasBash = available.has("bash") || available.has("shell");
  const hasExecuteCode =
    available.has("execute_code") || available.has("code_interpreter");
  if (!hasBash && !hasExecuteCode) return "";

  const lines = [
    "Some connected tools can execute code or shell commands.",
    hasBash
      ? "Use `bash`/shell tools for command output, repository work, package scripts, builds, and tests when the user asks for them."
      : "",
    hasExecuteCode
      ? "Use `execute_code`/code-interpreter tools for isolated Python, calculations, and data analysis."
      : "",
    "Do not calculate code results mentally or claim command output unless the result came from the tool.",
  ].filter(Boolean);
  return `\n\n${lines.join(" ")}`;
}

export function mcpToolsExtension(
  options: McpToolsExtensionOptions,
): ExtensionFactory {
  const { agentId } = options;
  const deps = options.deps ?? {};
  const listTools = deps.listTools ?? listTenantTools;
  const callTool = deps.callTool ?? callTenantTool;

  return defineExtension({
    name: "mcp-tools",
    description: "Exposes the agent's tenant MCP tools to the on-device agent.",
    async register(pi) {
      let defs;
      try {
        defs = await listTools(agentId, deps);
      } catch (err) {
        // Discovery failed — register nothing, run as plain chat. Logged, not thrown.
        pi.logger.warn(
          `mcp-tools: tools/list failed; running without connected tools: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }

      if (defs.length === 0) return;

      for (const def of defs) {
        if (!def.name) continue;
        const tool: Tool = {
          name: def.name,
          description: def.description ?? def.name,
          parameters: toParameters(def.inputSchema),
          // Each call goes back through the proxy. A proxy/transport throw becomes
          // an error tool-result (isError) so the loop can recover, not crash.
          execute: async (args) => {
            try {
              const result = await callTool(agentId, def.name, args, deps);
              return {
                content: tenantToolContentToText(result.content),
                isError: result.isError === true,
              };
            } catch (err) {
              return {
                content: `Tool "${def.name}" failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                isError: true,
              };
            }
          },
        };
        pi.registerTool(tool);
      }

      // Tell the model it has connected tools (system-prompt contribution via the
      // Pi-faithful before_agent_start event — same mechanism as cloud).
      const names = defs.map((d) => d.name).join(", ");
      const executionGuidance = codeExecutionGuidance(defs.map((d) => d.name));
      pi.on("before_agent_start", (e) => ({
        systemPrompt:
          `${e.systemPrompt}\n\nYou have access to your team's connected tools: ` +
          `${names}. Call them when they help complete the user's request.` +
          executionGuidance,
      }));
    },
  });
}
