export type WorkspaceSnapshot = Record<string, string>;

export interface FinalizeChangedFile {
  path: string;
  op: "create" | "modify" | "delete";
  content?: string;
  base_etag?: string;
}

interface WorkspaceBaselineFile {
  content: string;
}

type WorkspaceBaseline = Record<string, WorkspaceBaselineFile>;

const CONTROL_FILES = new Set([
  ".hydrate_manifest.json",
  ".rendered_at",
  "manifest.json",
  "_defaults_version",
]);

function normalizePath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized === "..") {
    return null;
  }
  if (
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  if (CONTROL_FILES.has(normalized)) return null;
  return normalized;
}

function normalizeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const normalized: WorkspaceSnapshot = {};
  for (const [rawPath, content] of Object.entries(snapshot)) {
    const path = normalizePath(rawPath);
    if (!path || typeof content !== "string") continue;
    normalized[path] = content;
  }
  return normalized;
}

export function buildWorkspaceBaseline(input: {
  snapshot: WorkspaceSnapshot;
}): WorkspaceBaseline {
  const baseline: WorkspaceBaseline = {};
  for (const [path, content] of Object.entries(
    normalizeSnapshot(input.snapshot),
  )) {
    baseline[path] = { content };
  }
  return baseline;
}

export function computeWorkspaceChangedFiles(input: {
  baseline: WorkspaceBaseline;
  current: WorkspaceSnapshot;
}): FinalizeChangedFile[] {
  const current = normalizeSnapshot(input.current);
  const paths = new Set([
    ...Object.keys(input.baseline),
    ...Object.keys(current),
  ]);
  const changes: FinalizeChangedFile[] = [];
  for (const path of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
    const before = input.baseline[path];
    const after = current[path];
    if (!before && typeof after === "string") {
      changes.push({ path, op: "create", content: after });
    } else if (before && typeof after !== "string") {
      changes.push({ path, op: "delete" });
    } else if (
      before &&
      typeof after === "string" &&
      before.content !== after
    ) {
      changes.push({ path, op: "modify", content: after });
    }
  }
  return changes;
}
