/**
 * THINK-910 — capability-scoped tool loading.
 *
 * Today every MCP server admitted by the dispatch contributes EVERY tool it
 * advertises to the model call: a fresh-thread KB question on `mcpherson`
 * assembled 86 tools, and the resulting tool-schema block is a large fraction
 * of the ~60K input tokens each model call carries. The capabilities manifest
 * already knows which connection operations the agent was actually GRANTED
 * (`class: "tool"`, `kind: "binding"` entries name `connection` + `operation`),
 * and connector sidecars carry the same allowlist as
 * `permissions.operations` (see packages/api/src/lib/capabilities/
 * connection-assignments.ts — `[]`/absent means "all tools").
 *
 * This module turns that knowledge into a filter over the assembled tool list.
 *
 * SAFETY POSTURE — ships dark. `TOOL_SCOPE_MODE` defaults to `all`, which is a
 * byte-for-byte no-op over today's behavior. Modes:
 *
 *   all             (default) — no filtering whatsoever.
 *   manifest        — narrow a connection's raw MCP tools ONLY when something
 *                     actually declares a narrowing for that connection
 *                     (manifest binding entries, or a connector sidecar
 *                     `permissions.operations` list). A connection nobody has
 *                     an opinion about keeps its full tool surface, so this
 *                     mode can never blind an agent whose capabilities were
 *                     never narrowed.
 *   manifest-strict — additionally drops the raw MCP tools of any connection
 *                     the manifest does not mention at all. Only meaningful
 *                     for `capability_folder_dispatch` agents (the manifest is
 *                     their whole capability surface); enable per stage after
 *                     `manifest` has soaked.
 *
 * What is NEVER dropped, in any mode (the "core platform" floor):
 *   - Pi built-ins (`BUILTIN_TOOL_NAMES`: read/bash/edit/write/grep/find/ls) —
 *     they are gated by the allowlist, not by this list, and are not filtered.
 *   - Extension-registered tool names (`bundle.extensionToolNames`) — memory,
 *     ask_user_question, task status, artifacts, delegation, skills, …
 *   - Every non-MCP AgentTool: session/skill/workspace primitives,
 *     execute_code, emit_json_render_ui, emit_analytics_chart, the file-read
 *     tool, the `mcp` proxy tool, and every manifest-registered binding/script
 *     capability tool.
 *
 * Only tools that came from `buildMcpTools` — identified structurally by the
 * `"<server>: <operation>"` label `mcp-connect.ts` stamps on them — are ever
 * candidates for removal. That is the surface the manifest has authority over.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/** Same tool shape `buildInvocationResources` collects; kept structural so
 * this module does not depend on the SDK's generic `AgentTool`. */
export interface ScopableTool {
  name: string;
  label?: string;
}

export interface ScopeManifestEntry {
  name: string;
  class: string;
  kind?: string;
  slug?: string;
  connection?: string;
  operation?: string;
  [key: string]: unknown;
}

export interface ScopeManifest {
  active: ScopeManifestEntry[];
  [key: string]: unknown;
}

export const TOOL_SCOPE_MODES = ["all", "manifest", "manifest-strict"] as const;
export type ToolScopeMode = (typeof TOOL_SCOPE_MODES)[number];

export const TOOL_SCOPE_MODE_ENV = "TOOL_SCOPE_MODE";

/**
 * Resolve the scope mode from the environment. Anything unrecognized (or
 * unset) resolves to `all` — the current, unfiltered behavior. Fail-open is
 * deliberate: a typo in a stage env var must not silently strip an agent's
 * tools.
 */
export function resolveToolScopeMode(
  env: Record<string, string | undefined> = process.env,
): ToolScopeMode {
  const raw = (env[TOOL_SCOPE_MODE_ENV] ?? "").trim().toLowerCase();
  return (TOOL_SCOPE_MODES as readonly string[]).includes(raw)
    ? (raw as ToolScopeMode)
    : "all";
}

/**
 * Split an MCP-built tool back into (server, operation). `mcp-connect.ts`
 * stamps `label: "<serverName>: <toolName>"` on every tool it builds, and the
 * exposed `name` is a lossily sanitized `mcp_<server>_<op>` — so the label is
 * the only reliable parse key. Returns null for anything that is not an
 * MCP-built tool (which is exactly the set this module refuses to touch).
 */
export function parseMcpToolLabel(
  tool: ScopableTool,
): { server: string; operation: string } | null {
  const label = typeof tool.label === "string" ? tool.label : "";
  const separator = label.indexOf(": ");
  if (separator <= 0) return null;
  // Manifest binding wrappers reuse the label shape with a " (binding)"
  // suffix; those are granted capabilities and must never be dropped.
  if (label.endsWith(" (binding)")) return null;
  if (!tool.name.startsWith("mcp_")) return null;
  const server = label.slice(0, separator).trim();
  const operation = label.slice(separator + 2).trim();
  if (!server || !operation) return null;
  return { server, operation };
}

/** Per-connection narrowing, keyed by connection/server name. */
export interface ConnectionNarrowing {
  /** Allowed operations. An entry present with an EMPTY set means "declared
   *  but empty" and is treated as no narrowing (matches the sidecar contract
   *  where `[]` = all tools). */
  operations: Set<string>;
  source: "manifest_binding" | "sidecar" | "manifest_binding+sidecar";
}

/**
 * Collect per-connection operation allowlists from the manifest's active
 * binding entries. A connection with no binding entries gets no key, i.e. no
 * opinion.
 */
export function narrowingFromManifest(
  manifest: ScopeManifest | null,
): Map<string, ConnectionNarrowing> {
  const out = new Map<string, ConnectionNarrowing>();
  if (!manifest || !Array.isArray(manifest.active)) return out;
  for (const entry of manifest.active) {
    if (!entry || entry.class !== "tool" || entry.kind !== "binding") continue;
    const connection =
      typeof entry.connection === "string" ? entry.connection : "";
    const operation =
      typeof entry.operation === "string" ? entry.operation : "";
    if (!connection || !operation) continue;
    const existing = out.get(connection);
    if (existing) existing.operations.add(operation);
    else {
      out.set(connection, {
        operations: new Set([operation]),
        source: "manifest_binding",
      });
    }
  }
  return out;
}

/** Connections the manifest mentions AT ALL (binding entries + `connection`
 *  class entries). Used only by `manifest-strict`. */
export function connectionsNamedByManifest(
  manifest: ScopeManifest | null,
): Set<string> {
  const out = new Set<string>();
  if (!manifest || !Array.isArray(manifest.active)) return out;
  for (const entry of manifest.active) {
    if (!entry) continue;
    if (entry.class === "connection") {
      if (typeof entry.name === "string" && entry.name) out.add(entry.name);
      if (typeof entry.slug === "string" && entry.slug) out.add(entry.slug);
    }
    if (typeof entry.connection === "string" && entry.connection) {
      out.add(entry.connection);
    }
  }
  return out;
}

/**
 * Read `connectors/<slug>/.assignment.json` (dual-read: legacy
 * `connections/<slug>/`) from the synced workspace and return its
 * `permissions.operations` allowlist. Absent / unreadable / malformed / empty
 * all mean "no narrowing" — never an implicit deny.
 */
export async function readConnectorOperationsFromWorkspace(
  workspaceDir: string,
  slug: string,
  deps: { readTextFile?: (p: string) => Promise<string | null> } = {},
): Promise<string[] | null> {
  const read =
    deps.readTextFile ??
    (async (filePath: string) => {
      try {
        return await readFile(filePath, "utf-8");
      } catch {
        return null;
      }
    });
  for (const folder of ["connectors", "connections"]) {
    const raw = await read(
      path.join(workspaceDir, folder, slug, ".assignment.json"),
    );
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        permissions?: { operations?: unknown };
      };
      const operations = parsed?.permissions?.operations;
      if (!Array.isArray(operations)) return null;
      const clean = operations.filter(
        (value): value is string => typeof value === "string" && value !== "",
      );
      return clean.length > 0 ? clean : null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface ScopeToolsArgs {
  mode: ToolScopeMode;
  tools: readonly ScopableTool[];
  manifest: ScopeManifest | null;
  /** Per-connection sidecar allowlists, already read from the workspace.
   *  Keyed by connection/server name. Empty/absent = no narrowing. */
  sidecarOperations?: ReadonlyMap<string, readonly string[]>;
}

export interface ScopeToolsResult {
  tools: ScopableTool[];
  mode: ToolScopeMode;
  /** Tools present before filtering. */
  before: number;
  /** Tools kept. */
  after: number;
  /** Names of the dropped tools, bounded for the diagnostics blob. */
  dropped: string[];
  /** Every dropped tool name (unbounded) — the callers' filter key. */
  droppedNames: string[];
  /** Per-connection outcome, for ops queries. */
  connections: Array<{
    server: string;
    kept: number;
    dropped: number;
    reason: "no_narrowing" | "narrowed" | "not_in_manifest";
  }>;
}

const MAX_REPORTED_DROPPED = 60;

/**
 * Apply capability scoping to an assembled tool list. Pure and synchronous —
 * every I/O-shaped input (manifest, sidecar allowlists) is passed in, so both
 * modes are directly unit-testable.
 */
export function scopeTools(args: ScopeToolsArgs): ScopeToolsResult {
  const tools = [...args.tools];
  const base: ScopeToolsResult = {
    tools,
    mode: args.mode,
    before: tools.length,
    after: tools.length,
    dropped: [],
    droppedNames: [],
    connections: [],
  };
  if (args.mode === "all") return base;

  const manifestNarrowing = narrowingFromManifest(args.manifest);
  const namedConnections = connectionsNamedByManifest(args.manifest);
  const sidecar = args.sidecarOperations ?? new Map();

  // Group the MCP-built tools by server so per-connection decisions are made
  // once, with a reason we can report.
  const mcpByServer = new Map<
    string,
    Array<{ tool: ScopableTool; operation: string }>
  >();
  for (const tool of tools) {
    const parsed = parseMcpToolLabel(tool);
    if (!parsed) continue;
    const bucket = mcpByServer.get(parsed.server);
    if (bucket) bucket.push({ tool, operation: parsed.operation });
    else
      mcpByServer.set(parsed.server, [{ tool, operation: parsed.operation }]);
  }

  const dropped = new Set<ScopableTool>();
  const connections: ScopeToolsResult["connections"] = [];

  for (const [server, entries] of mcpByServer) {
    const allowed = new Set<string>();
    for (const operation of manifestNarrowing.get(server)?.operations ?? []) {
      allowed.add(operation);
    }
    for (const operation of sidecar.get(server) ?? []) allowed.add(operation);

    if (allowed.size === 0) {
      // Nobody declared a narrowing for this connection.
      if (
        args.mode === "manifest-strict" &&
        args.manifest &&
        namedConnections.size > 0 &&
        !namedConnections.has(server)
      ) {
        for (const entry of entries) dropped.add(entry.tool);
        connections.push({
          server,
          kept: 0,
          dropped: entries.length,
          reason: "not_in_manifest",
        });
        continue;
      }
      connections.push({
        server,
        kept: entries.length,
        dropped: 0,
        reason: "no_narrowing",
      });
      continue;
    }

    let kept = 0;
    let removed = 0;
    for (const entry of entries) {
      if (allowed.has(entry.operation)) kept += 1;
      else {
        dropped.add(entry.tool);
        removed += 1;
      }
    }
    connections.push({ server, kept, dropped: removed, reason: "narrowed" });
  }

  const keptTools = tools.filter((tool) => !dropped.has(tool));
  const droppedNames = [...dropped].map((tool) => tool.name).sort();
  return {
    tools: keptTools,
    mode: args.mode,
    before: tools.length,
    after: keptTools.length,
    dropped: droppedNames.slice(0, MAX_REPORTED_DROPPED),
    droppedNames,
    connections: connections.sort((a, b) => a.server.localeCompare(b.server)),
  };
}

/**
 * Read every connector sidecar allowlist relevant to the servers present in
 * the assembled tool list. Slug lookup is by server name — the connector
 * folder slug and the MCP `serverName` are the same identifier on the
 * capability-folder path. Missing files are simply absent from the map.
 */
export async function readSidecarOperations(
  workspaceDir: string,
  servers: Iterable<string>,
  deps: { readTextFile?: (p: string) => Promise<string | null> } = {},
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const server of new Set(servers)) {
    const operations = await readConnectorOperationsFromWorkspace(
      workspaceDir,
      server,
      deps,
    );
    if (operations && operations.length > 0) out.set(server, operations);
  }
  return out;
}

/** Server names of the MCP-built tools in an assembled tool list. */
export function mcpServersInTools(tools: readonly ScopableTool[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    const parsed = parseMcpToolLabel(tool);
    if (parsed) out.add(parsed.server);
  }
  return [...out].sort();
}
