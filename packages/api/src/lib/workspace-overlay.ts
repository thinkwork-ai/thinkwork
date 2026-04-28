/**
 * Workspace path helpers.
 *
 * Per docs/plans/2026-04-27-003 (materialize-at-write-time): the runtime
 * composer is gone. The agent's S3 prefix is the source of truth for the
 * runtime; copying-from-template happens at write time inside
 * `workspace-bootstrap.ts`. The only things that survive in this module
 * are the path-walking helpers used by `agentPinStatus`:
 *
 *   - `buildWorkspaceAncestorPaths` — the deepest-first walk that pin
 *     resolution still uses to find an inherited pin one folder up.
 *   - `pinLookupPaths` — the same walk, filtered to pin-eligible paths.
 *
 * The classify / canonical-file helpers from `@thinkwork/workspace-defaults`
 * are re-exported so existing call sites don't need to chase the source
 * package.
 */

import {
  CANONICAL_FILE_NAMES,
  type CanonicalFileName,
  classifyFile,
  MANAGED_FILES,
  PINNED_FILES,
} from "@thinkwork/workspace-defaults";
import {
  normalizeWorkspacePath,
  parseWorkspacePinPath,
} from "./pinned-versions.js";
import { isReservedFolderSegment } from "./reserved-folder-names.js";

/**
 * Return the ancestor-walk paths for a workspace path, deepest first.
 *
 *   "GUARDRAILS.md"                          → ["GUARDRAILS.md"]
 *   "expenses/GUARDRAILS.md"                 → ["expenses/GUARDRAILS.md", "GUARDRAILS.md"]
 *   "expenses/escalation/GUARDRAILS.md"      → 3 entries, deepest → root
 *   "memory/lessons.md"                      → ["memory/lessons.md"]   (reserved scope)
 *
 * Reserved folder segments terminate the walk: `memory/` and `skills/`
 * are bounded so they never collapse to a different file at an outer
 * scope.
 */
export function buildWorkspaceAncestorPaths(path: string): string[] {
  const cleanPath = normalizeWorkspacePath(path);
  const segments = cleanPath.split("/");
  if (segments.some(isReservedFolderSegment)) {
    return [cleanPath];
  }
  if (segments.length === 1) return [cleanPath];
  const basename = segments[segments.length - 1];
  let folders = segments.slice(0, -1);
  const out = [cleanPath];
  while (folders.length > 0) {
    folders = folders.slice(0, -1);
    const ancestor =
      folders.length > 0 ? `${folders.join("/")}/${basename}` : basename;
    out.push(ancestor);
  }
  return out;
}

export function pinLookupPaths(path: string): string[] {
  if (!parseWorkspacePinPath(path)) return [];
  return buildWorkspaceAncestorPaths(path).filter((candidate) =>
    Boolean(parseWorkspacePinPath(candidate)),
  );
}

export { classifyFile, PINNED_FILES, MANAGED_FILES, CANONICAL_FILE_NAMES };
export type { CanonicalFileName };
