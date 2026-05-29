// Bridges an MCP (Builder) tool into a harness Tool.
//
// The harness advertises the tool's schema to the model; on call it invokes the MCP tool
// over JSON-RPC and returns the result as tool content. MCP failures are returned as
// `isError` results (not thrown) so the loop feeds them back to the model to recover from,
// rather than aborting the turn. `call` is injectable so this is testable without network
// and so the auth strategy (legacy shared bearer vs. the user's idToken) can evolve behind
// it without touching the bridge.

import { callMcpTool } from "../../mcp-client";
import type { JsonSchema, Tool } from "../types";

export interface McpToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type McpCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function createMcpTool(
  def: McpToolDef,
  call: McpCall = callMcpTool,
): Tool {
  return {
    spec: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
    execute: async (args) => {
      try {
        const result = await call(def.name, args);
        const content =
          typeof result === "string" ? result : JSON.stringify(result);
        return { content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: `MCP tool "${def.name}" failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
