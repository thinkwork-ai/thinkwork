import type { FinalizeChangedFile } from "./finalize-client.js";

export type { FinalizeChangedFile } from "./finalize-client.js";

export type WorkspaceSnapshot = Record<string, string>;

export interface WorkspaceBaselineFile {
  content: string;
  etag?: string;
}

export type WorkspaceBaseline = Record<string, WorkspaceBaselineFile>;

export interface WorkspaceHydrateManifestLike {
  files?: Array<{
    path?: unknown;
    etag?: unknown;
  }>;
}

export const WORKSPACE_DIFF_CONTROL_FILES = new Set([
  ".hydrate_manifest.json",
  ".rendered_at",
  ".thinkwork-workspace-cache.json",
  "manifest.json",
  "_defaults_version",
]);

export function normalizeWorkspaceDiffPath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  if (normalized.startsWith("../") || normalized === "..") return null;
  if (
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  if (WORKSPACE_DIFF_CONTROL_FILES.has(normalized)) return null;
  return normalized;
}

export function normalizeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const normalized: WorkspaceSnapshot = {};
  for (const [rawPath, content] of Object.entries(snapshot)) {
    const path = normalizeWorkspaceDiffPath(rawPath);
    if (!path || typeof content !== "string") continue;
    normalized[path] = content;
  }
  return normalized;
}

export function buildWorkspaceBaseline(input: {
  snapshot: WorkspaceSnapshot;
  hydrateManifest?: WorkspaceHydrateManifestLike | null;
}): WorkspaceBaseline {
  const normalizedSnapshot = normalizeWorkspaceSnapshot(input.snapshot);
  const etags = new Map<string, string>();
  for (const file of input.hydrateManifest?.files ?? []) {
    if (typeof file.path !== "string") continue;
    const path = normalizeWorkspaceDiffPath(file.path);
    if (!path || typeof file.etag !== "string" || !file.etag.trim()) continue;
    etags.set(path, file.etag.trim());
  }

  const baseline: WorkspaceBaseline = {};
  for (const [path, content] of Object.entries(normalizedSnapshot)) {
    baseline[path] = {
      content,
      etag: etags.get(path),
    };
  }
  return baseline;
}

export function computeWorkspaceChangedFiles(input: {
  baseline: WorkspaceBaseline;
  current: WorkspaceSnapshot;
}): FinalizeChangedFile[] {
  const current = normalizeWorkspaceSnapshot(input.current);
  const changed: FinalizeChangedFile[] = [];
  const paths = new Set([
    ...Object.keys(input.baseline),
    ...Object.keys(current),
  ]);

  for (const path of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
    const before = input.baseline[path];
    const after = current[path];
    if (!before && typeof after === "string") {
      changed.push({ path, op: "create", content: after });
      continue;
    }
    if (before && typeof after !== "string") {
      changed.push({ path, op: "delete", base_etag: before.etag });
      continue;
    }
    if (before && typeof after === "string" && before.content !== after) {
      changed.push({
        path,
        op: "modify",
        content: after,
        base_etag: before.etag,
      });
    }
  }

  return changed;
}
