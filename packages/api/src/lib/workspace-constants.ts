/**
 * Canonical workspace folder names and path patterns
 * (subagent-folders plan 2026-07-15-001, U14 — R19).
 *
 * One module owns the folder-name literals so the connections/→connectors/
 * rename (U15) is a constant flip plus a `CAPABILITY_COMPILE_REVISION`
 * bump instead of a scavenger hunt.
 *
 * U15 FLIPPED (R18/R19): the root plural is now `connectors/`. Writers
 * emit the new spelling everywhere; READERS run a dual-read window — the
 * regex builders accept `{ dualRead: true }` to match BOTH spellings
 * (`connect(?:ion|or)s`) until the per-tenant mover
 * (`thinkwork migrate-connectors`) has relocated every legacy
 * `connections/` folder and the window closes in a follow-up cleanup.
 *
 * The connection-class name is SCOPE-AWARE (plan KTD-6): grant folders
 * inside a sub-agent folder (`agents/<slug>/connectors/<conn>/`) debuted
 * the `connectors/` spelling greenfield (U5/U7); post-flip both scopes
 * spell `connectors/`.
 */

import {
  CONNECTION_DEFINITION_FILE,
  TOOL_DEFINITION_FILE,
  CAPABILITY_SIDECAR_FILE,
} from "./capabilities/definition-schemas.js";

export type CapabilityFolderScope = "root" | "agent";

export const WORKSPACE_SKILLS_FOLDER = "skills";
export const WORKSPACE_MCP_FOLDER = "mcp";
export const WORKSPACE_AGENTS_FOLDER = "agents";

/**
 * Root spelling of the connection class. U15 flipped this to
 * "connectors" (R18) — the flip PR ships dual-read alternation in the
 * reconciler/renderer and a compile-revision bump (rev 4→5) alongside.
 */
export const ROOT_CONNECTIONS_FOLDER = "connectors";

/**
 * Legacy root spelling, accepted by dual-read regexes during the rename
 * window and swept by detach paths + the `migrate-connectors` mover.
 * The `connections` DB table keeps its name — only the workspace folder
 * renamed (R18).
 */
export const LEGACY_ROOT_CONNECTIONS_FOLDER = "connections";

/** Child-scope spelling — greenfield `connectors/`, never `connections/`. */
export const AGENT_CONNECTORS_FOLDER = "connectors";

/**
 * Regex source fragment matching BOTH connection-folder spellings
 * (dual-read window, plan U15): `connect(?:ion|or)s`. Non-capturing so
 * builders that embed it keep their existing group numbering.
 */
export const CONNECTION_FOLDER_DUAL_READ_SOURCE = "connect(?:ion|or)s";

export interface FolderPatternOptions {
  /**
   * Accept BOTH `connections/` and `connectors/` (U15 dual-read window).
   * Readers that scan existing workspaces pass true; writers and key
   * builders never do — they always emit the new spelling.
   */
  dualRead?: boolean;
}

function connectionFolderPatternSource(
  scope: CapabilityFolderScope,
  options: FolderPatternOptions,
): string {
  return options.dualRead
    ? CONNECTION_FOLDER_DUAL_READ_SOURCE
    : capabilityFolderName("connection", scope);
}

export const TOOLS_FOLDER = "tools";

export function capabilityFolderName(
  klass: "connection" | "tool" | "agent",
  scope: CapabilityFolderScope = "root",
): string {
  if (klass === "tool") return TOOLS_FOLDER;
  if (klass === "agent") return WORKSPACE_AGENTS_FOLDER;
  return scope === "agent" ? AGENT_CONNECTORS_FOLDER : ROOT_CONNECTIONS_FOLDER;
}

export function capabilityDefinitionFileName(
  klass: "connection" | "tool",
): string {
  return klass === "connection"
    ? CONNECTION_DEFINITION_FILE
    : TOOL_DEFINITION_FILE;
}

/** `skills/<folder>/SKILL.md` marker — the installed-skill presence rule. */
export function skillMarkerRe(): RegExp {
  return new RegExp(`^${WORKSPACE_SKILLS_FOLDER}/([^/]+)/SKILL\\.md$`);
}

/** Per-assignment state file beside the skill marker (absent = enabled). */
export function skillAssignmentRe(): RegExp {
  return new RegExp(
    `^${WORKSPACE_SKILLS_FOLDER}/([^/]+)/\\.assignment\\.json$`,
  );
}

/** `connectors/<slug>/CONNECTION.md` capability marker (dual-read aware). */
export function connectionMarkerRe(
  scope: CapabilityFolderScope = "root",
  options: FolderPatternOptions = {},
): RegExp {
  return new RegExp(
    `^${connectionFolderPatternSource(scope, options)}/([^/]+)/${CONNECTION_DEFINITION_FILE.replace(".", "\\.")}$`,
  );
}

export function connectionAssignmentRe(
  scope: CapabilityFolderScope = "root",
  options: FolderPatternOptions = {},
): RegExp {
  return new RegExp(
    `^${connectionFolderPatternSource(scope, options)}/([^/]+)/\\.assignment\\.json$`,
  );
}

export function toolMarkerRe(): RegExp {
  return new RegExp(
    `^${TOOLS_FOLDER}/([^/]+)/${TOOL_DEFINITION_FILE.replace(".", "\\.")}$`,
  );
}

export function toolAssignmentRe(): RegExp {
  return new RegExp(`^${TOOLS_FOLDER}/([^/]+)/\\.assignment\\.json$`);
}

/** `mcp/<slug>/MCP.md` first-class capability marker (THINK-302 U4). */
export function mcpMarkerRe(): RegExp {
  return new RegExp(`^${WORKSPACE_MCP_FOLDER}/([^/]+)/MCP\\.md$`);
}

/** `agents/<slug>/INSTRUCTIONS.md` marker (subagent-folders U4). */
export function agentMarkerRe(): RegExp {
  return new RegExp(`^${WORKSPACE_AGENTS_FOLDER}/([^/]+)/INSTRUCTIONS\\.md$`);
}

export function agentAssignmentRe(): RegExp {
  return new RegExp(
    `^${WORKSPACE_AGENTS_FOLDER}/([^/]+)/\\.assignment\\.json$`,
  );
}

/**
 * Every capability-folder file (markers, entry scripts, support files)
 * for input-signature/etag scans:
 * `^(connectors|tools|agents)/<slug>/<path>$`. Group 1 is the folder
 * name — map back to a class via `capabilityClassFromFolderName`.
 * With `{ dualRead: true }` group 1 also matches legacy `connections`.
 */
export function capabilityFolderFileRe(
  scope: CapabilityFolderScope = "root",
  options: FolderPatternOptions = {},
): RegExp {
  return new RegExp(
    `^(${connectionFolderPatternSource(scope, options)}|${TOOLS_FOLDER}|${WORKSPACE_MCP_FOLDER}|${WORKSPACE_AGENTS_FOLDER})/([^/]+)/(.+)$`,
  );
}

export function capabilityClassFromFolderName(
  folder: string,
): "connection" | "tool" | "agent" | "mcp" | null {
  if (folder === TOOLS_FOLDER) return "tool";
  if (folder === WORKSPACE_MCP_FOLDER) return "mcp";
  if (folder === WORKSPACE_AGENTS_FOLDER) return "agent";
  if (
    folder === ROOT_CONNECTIONS_FOLDER ||
    folder === LEGACY_ROOT_CONNECTIONS_FOLDER
  )
    return "connection";
  return null;
}

/** `mcp/<slug>/.assignment.json` marker — the attached-server presence rule. */
export function mcpAssignmentRe(): RegExp {
  return new RegExp(`^${WORKSPACE_MCP_FOLDER}/([^/]+)/\\.assignment\\.json$`);
}

export { CAPABILITY_SIDECAR_FILE };
