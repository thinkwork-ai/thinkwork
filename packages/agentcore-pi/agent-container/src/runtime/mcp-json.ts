/**
 * Plan §006 U1 — mcp.json workspace-file reader.
 *
 * Reads the agent's per-workspace MCP config from `<workspaceDir>/mcp.json`.
 * Today the only field is `directTools` — an allowlist of (server, tool) pairs
 * the agent wants surfaced as first-class AgentTools instead of behind the
 * `mcp` proxy. Future fields (per-server lifecycle, idleTimeout, etc.) land
 * here without needing a second config file.
 *
 * Lifecycle:
 *   - Called once per invocation from the trusted handler, after
 *     `bootstrapWorkspace` has copied the agent's S3 workspace prefix to
 *     `/tmp/workspace`.
 *   - Missing file → return an empty config (the intentional default).
 *   - Malformed JSON or wrong shape → throw `McpJsonError`. The trusted
 *     handler surfaces this through the same tool-assembly-failure path
 *     as other `assembleTools` throws (drains cleanup queue, returns 500).
 *
 * Unknown top-level keys are preserved on the returned object so a later
 * field added upstream (e.g., per-server timeouts) is forward-compatible
 * without coordination across PRs.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const MCP_JSON_FILENAME = "mcp.json";

export interface McpDirectTool {
  /** MCP server slug — matches `serverName` in the mcp_configs payload. */
  server: string;
  /** Tool name as exposed by the MCP server's `tools/list`. */
  tool: string;
}

export interface McpJsonConfig {
  directTools: McpDirectTool[];
  /** Forward-compat: extra top-level keys are preserved. */
  [key: string]: unknown;
}

export class McpJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpJsonError";
  }
}

function emptyConfig(): McpJsonConfig {
  return { directTools: [] };
}

export async function readMcpJson(
  workspaceDir: string,
): Promise<McpJsonConfig> {
  const filePath = path.join(workspaceDir, MCP_JSON_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return emptyConfig();
  }
  const trimmed = raw.trim();
  if (!trimmed) return emptyConfig();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new McpJsonError(
      `${MCP_JSON_FILENAME}: invalid JSON (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpJsonError(
      `${MCP_JSON_FILENAME}: top-level value must be a JSON object.`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  const directTools: McpDirectTool[] = [];
  const directToolsRaw = obj.directTools;

  if (directToolsRaw === undefined) {
    // directTools is optional; an empty allowlist is a valid config.
  } else if (!Array.isArray(directToolsRaw)) {
    throw new McpJsonError(
      `${MCP_JSON_FILENAME}: \`directTools\` must be an array.`,
    );
  } else {
    directToolsRaw.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new McpJsonError(
          `${MCP_JSON_FILENAME}: \`directTools[${index}]\` must be an object.`,
        );
      }
      const e = entry as Record<string, unknown>;
      const server = typeof e.server === "string" ? e.server.trim() : "";
      const tool = typeof e.tool === "string" ? e.tool.trim() : "";
      if (!server) {
        throw new McpJsonError(
          `${MCP_JSON_FILENAME}: \`directTools[${index}].server\` is required.`,
        );
      }
      if (!tool) {
        throw new McpJsonError(
          `${MCP_JSON_FILENAME}: \`directTools[${index}].tool\` is required.`,
        );
      }
      directTools.push({ server, tool });
    });
  }

  return { ...obj, directTools };
}
