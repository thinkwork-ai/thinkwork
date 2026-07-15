/**
 * Canonical workspace folder names and path patterns
 * (subagent-folders plan 2026-07-15-001, U14 — R19).
 *
 * One module owns the folder-name literals so the connections/→connectors/
 * rename (U15) is a constant flip plus a `CAPABILITY_COMPILE_REVISION`
 * bump instead of a scavenger hunt. Ships inert: every export reproduces
 * today's spellings byte-for-byte at root scope.
 *
 * The connection-class name is SCOPE-AWARE (plan KTD-6): grant folders
 * inside a sub-agent folder (`agents/<slug>/connectors/<conn>/`) debut the
 * `connectors/` spelling greenfield (U5/U7), while the root plural stays
 * `connections/` until the U15 flip. Callers building child-grant keys
 * must pass scope "agent".
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
 * Root spelling of the connection class. This is THE constant U15 flips
 * to "connectors" (with dual-read alternation in the reconciler/renderer
 * and a compile-revision bump in the same PR).
 */
export const ROOT_CONNECTIONS_FOLDER = "connections";

/** Child-scope spelling — greenfield `connectors/`, never `connections/`. */
export const AGENT_CONNECTORS_FOLDER = "connectors";

export const TOOLS_FOLDER = "tools";

export function capabilityFolderName(
  klass: "connection" | "tool",
  scope: CapabilityFolderScope = "root",
): string {
  if (klass === "tool") return TOOLS_FOLDER;
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

/** `<connections|connectors>/<slug>/CONNECTION.md` capability marker. */
export function connectionMarkerRe(
  scope: CapabilityFolderScope = "root",
): RegExp {
  return new RegExp(
    `^${capabilityFolderName("connection", scope)}/([^/]+)/${CONNECTION_DEFINITION_FILE.replace(".", "\\.")}$`,
  );
}

export function connectionAssignmentRe(
  scope: CapabilityFolderScope = "root",
): RegExp {
  return new RegExp(
    `^${capabilityFolderName("connection", scope)}/([^/]+)/\\.assignment\\.json$`,
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

/**
 * Every capability-folder file (markers, entry scripts, support files)
 * for input-signature/etag scans: `^(connections|tools)/<slug>/<path>$`.
 * Group 1 is the folder name — map back to a class via
 * `capabilityClassFromFolderName`.
 */
export function capabilityFolderFileRe(
  scope: CapabilityFolderScope = "root",
): RegExp {
  return new RegExp(
    `^(${capabilityFolderName("connection", scope)}|${TOOLS_FOLDER})/([^/]+)/(.+)$`,
  );
}

export function capabilityClassFromFolderName(
  folder: string,
): "connection" | "tool" | null {
  if (folder === TOOLS_FOLDER) return "tool";
  if (folder === ROOT_CONNECTIONS_FOLDER || folder === AGENT_CONNECTORS_FOLDER)
    return "connection";
  return null;
}

/** `mcp/<slug>/.assignment.json` marker — the attached-server presence rule. */
export function mcpAssignmentRe(): RegExp {
  return new RegExp(`^${WORKSPACE_MCP_FOLDER}/([^/]+)/\\.assignment\\.json$`);
}

export { CAPABILITY_SIDECAR_FILE };
