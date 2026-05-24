/**
 * Plan §006 U2 — McpToolRegistry + validateDirectTools.
 *
 * Per-invocation in-memory map from `(server, tool)` to the metadata the MCP
 * server returned at `tools/list` time. The `mcp` proxy AgentTool (U3) reads
 * the registry for its `list` / `search` modes; the proxy's `call` mode uses
 * `get(server, tool)` to validate before dispatching. The validator function
 * cross-checks an `mcp.json` `directTools` allowlist against the live registry
 * at handler entry so typos fail loud instead of silently demoting tools to
 * the proxy.
 *
 * Lifecycle: instantiated per invocation alongside the HandleStore. Lives
 * only in the trusted handler's address space. NOT shared across invocations
 * — sharing would let a directTool from one tenant resolve against another
 * tenant's tools/list cache. Per-invocation isolation is a security
 * invariant; do not cache this at module scope.
 *
 * The registry stores tools that have already passed any per-server
 * `toolWhitelist` filter. Code that populates the registry MUST apply the
 * whitelist BEFORE calling `register()` — otherwise the proxy's `call` mode
 * would be able to address tools the operator explicitly hid.
 */

import type { McpDirectTool } from "./runtime/mcp-json.js";

export interface RegistryEntry {
  /** MCP server slug (display name). */
  server: string;
  /** Tool name as the MCP server exposes it. */
  tool: string;
  /** Human description from the MCP `tools/list` response. May be empty. */
  description: string;
  /** Raw input-schema object from the MCP `tools/list` response. */
  inputSchema: unknown;
}

export type ToolMetadataInput = Pick<
  RegistryEntry,
  "tool" | "description" | "inputSchema"
> & { description?: string };

export interface SearchOptions {
  /** When true, include `inputSchema` in returned entries; otherwise omit. */
  includeSchemas?: boolean;
}

function compareEntries(a: RegistryEntry, b: RegistryEntry): number {
  if (a.server !== b.server) return a.server.localeCompare(b.server);
  return a.tool.localeCompare(b.tool);
}

export class McpToolRegistry {
  private readonly byServer = new Map<string, Map<string, RegistryEntry>>();

  /** Register one MCP tool. Duplicate `(server, tool)` overwrites. */
  register(server: string, metadata: ToolMetadataInput): void {
    let tools = this.byServer.get(server);
    if (!tools) {
      tools = new Map<string, RegistryEntry>();
      this.byServer.set(server, tools);
    }
    tools.set(metadata.tool, {
      server,
      tool: metadata.tool,
      description: metadata.description ?? "",
      inputSchema: metadata.inputSchema,
    });
  }

  /** All registered entries, sorted by (server, tool). */
  entries(): RegistryEntry[] {
    const out: RegistryEntry[] = [];
    for (const tools of this.byServer.values()) {
      for (const entry of tools.values()) out.push(entry);
    }
    return out.sort(compareEntries);
  }

  /** Returns the metadata for `(server, tool)`, or undefined if absent. */
  get(server: string, tool: string): RegistryEntry | undefined {
    return this.byServer.get(server)?.get(tool);
  }

  /** Tool names registered for `server`, sorted. Empty array if unknown. */
  toolsForServer(server: string): string[] {
    const tools = this.byServer.get(server);
    if (!tools) return [];
    return [...tools.keys()].sort();
  }

  /** True when `server` has at least one registered tool. */
  hasServer(server: string): boolean {
    return this.byServer.has(server);
  }

  /**
   * Case-insensitive substring search across tool name + description.
   * Returns matches sorted by (server, tool). When `includeSchemas` is
   * false (default), `inputSchema` is replaced with `undefined` in the
   * returned copies to keep the response size bounded.
   */
  search(query: string, opts: SearchOptions = {}): RegistryEntry[] {
    const q = query.trim().toLowerCase();
    const includeSchemas = opts.includeSchemas === true;
    const matches: RegistryEntry[] = [];
    for (const tools of this.byServer.values()) {
      for (const entry of tools.values()) {
        if (
          q === "" ||
          entry.tool.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q)
        ) {
          matches.push(
            includeSchemas
              ? entry
              : { ...entry, inputSchema: undefined },
          );
        }
      }
    }
    return matches.sort(compareEntries);
  }

  /** Number of registered tools across all servers. Diagnostic only. */
  get size(): number {
    let n = 0;
    for (const tools of this.byServer.values()) n += tools.size;
    return n;
  }
}

// ---------------------------------------------------------------------------
// validateDirectTools — boot-time allowlist cross-check.
// ---------------------------------------------------------------------------

export interface DirectToolsMismatch {
  /** The directTools entry that could not be resolved. */
  server: string;
  tool: string;
  /** The tools the registry actually has for this server. Empty when the
   *  server itself is not registered. */
  availableTools: string[];
  /** Discriminator: did the server exist at all, or was the tool missing? */
  reason: "server_not_configured" | "tool_not_listed";
}

export type ValidateDirectToolsResult =
  | { ok: true }
  | { ok: false; missing: DirectToolsMismatch[] };

/**
 * Cross-check every `directTools` entry against the registry. Returns
 * `{ ok: true }` when every entry resolves; otherwise returns the full
 * list of mismatches so the caller can surface a single structured
 * error naming every offending entry plus the actually-available tools
 * per server.
 *
 * The validator does NOT throw — it returns a result. The trusted
 * handler decides whether to throw on `{ ok: false }` so the throw can
 * carry tenant + identity context the validator should not see.
 */
export function validateDirectTools(
  directTools: readonly McpDirectTool[],
  registry: McpToolRegistry,
): ValidateDirectToolsResult {
  const missing: DirectToolsMismatch[] = [];
  for (const entry of directTools) {
    const serverKnown = registry.hasServer(entry.server);
    const toolKnown = registry.get(entry.server, entry.tool) !== undefined;
    if (toolKnown) continue;
    missing.push({
      server: entry.server,
      tool: entry.tool,
      availableTools: serverKnown ? registry.toolsForServer(entry.server) : [],
      reason: serverKnown ? "tool_not_listed" : "server_not_configured",
    });
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}
