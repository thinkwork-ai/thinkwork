import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildWorkspaceBaseline,
  computeWorkspaceChangedFiles,
  normalizeWorkspaceDiffPath,
  type FinalizeChangedFile,
  type WorkspaceBaseline,
  type WorkspaceSnapshot,
} from "@thinkwork/pi-runtime-core";

const HYDRATE_MANIFEST_PATH = ".hydrate_manifest.json";
const MAX_WORKSPACE_DIFF_FILE_BYTES = 256 * 1024;
const SKIPPED_DIRS = new Set([".git", "debug", "node_modules"]);

export async function createLocalWorkspaceBaseline(input: {
  workspaceDir: string;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}): Promise<WorkspaceBaseline> {
  const hydrateManifest = await readHydrateManifest(
    input.workspaceDir,
    input.log,
  );
  const snapshot = await readLocalWorkspaceSnapshot(
    input.workspaceDir,
    input.log,
    runtimeToManifestPathMap(hydrateManifest),
  );
  return buildWorkspaceBaseline({ snapshot, hydrateManifest });
}

export async function collectLocalWorkspaceChangedFiles(input: {
  workspaceDir: string;
  baseline?: WorkspaceBaseline;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}): Promise<FinalizeChangedFile[]> {
  if (!input.baseline) return [];
  const hydrateManifest = await readHydrateManifest(
    input.workspaceDir,
    input.log,
  );
  return computeWorkspaceChangedFiles({
    baseline: input.baseline,
    current: await readLocalWorkspaceSnapshot(
      input.workspaceDir,
      input.log,
      runtimeToManifestPathMap(hydrateManifest),
    ),
  });
}

/**
 * A file mounted mid-turn by `fetch_workspace_source` (plan 2026-06-12-002
 * U5). Paths are workspace-relative RUNTIME paths (e.g. `Spaces/b/notes.md`)
 * — fetched files have no hydrate-manifest entry, so the end-of-turn snapshot
 * keys them by their on-disk relative path directly.
 */
export interface FetchedWorkspaceBaselineFile {
  path: string;
  bytes: Uint8Array;
  etag?: string;
}

/**
 * Append fetched, read-only files to an existing turn baseline so the
 * end-of-turn diff reports zero changes for them (no phantom creates).
 *
 * Mirrors the snapshot reader's own filters exactly: a file the snapshot
 * would skip (oversized or binary) must ALSO be skipped here, otherwise the
 * baseline gains an entry the snapshot never produces and the diff reports a
 * phantom delete. Re-appending the same path overwrites in place — an
 * idempotent re-fetch creates no duplicate entries. Returns the number of
 * baseline entries written.
 */
export function appendFetchedFilesToWorkspaceBaseline(
  baseline: WorkspaceBaseline,
  files: readonly FetchedWorkspaceBaselineFile[],
): number {
  let appended = 0;
  for (const file of files) {
    const normalizedPath = normalizeWorkspaceDiffPath(file.path);
    if (!normalizedPath) continue;
    if (file.bytes.byteLength > MAX_WORKSPACE_DIFF_FILE_BYTES) continue;
    if (file.bytes.includes(0)) continue;
    baseline[normalizedPath] = {
      content: new TextDecoder().decode(file.bytes),
      etag: file.etag?.trim() || undefined,
    };
    appended += 1;
  }
  return appended;
}

async function readHydrateManifest(
  workspaceDir: string,
  log?: (message: string, fields?: Record<string, unknown>) => void,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(path.join(workspaceDir, HYDRATE_MANIFEST_PATH), "utf8"),
    ) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.("agentcore_pi_hydrate_manifest_read_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

async function readLocalWorkspaceSnapshot(
  workspaceDir: string,
  log?: (message: string, fields?: Record<string, unknown>) => void,
  pathMap: Map<string, string> = new Map(),
): Promise<WorkspaceSnapshot> {
  const files: WorkspaceSnapshot = {};
  async function visit(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIPPED_DIRS.has(entry)) continue;
      const absolutePath = path.join(dir, entry);
      const info = await stat(absolutePath).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!info.isFile() || info.size > MAX_WORKSPACE_DIFF_FILE_BYTES) {
        continue;
      }
      const bytes = await readFile(absolutePath).catch((err: unknown) => {
        log?.("agentcore_pi_workspace_diff_file_read_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      if (!bytes || bytes.includes(0)) continue;
      const relativePath = path
        .relative(workspaceDir, absolutePath)
        .split(path.sep)
        .join("/");
      files[pathMap.get(relativePath) ?? relativePath] =
        new TextDecoder().decode(bytes);
    }
  }
  await visit(workspaceDir);
  return files;
}

function runtimeToManifestPathMap(
  hydrateManifest: Record<string, unknown> | null,
): Map<string, string> {
  const out = new Map<string, string>();
  const files = Array.isArray(hydrateManifest?.files)
    ? hydrateManifest.files
    : [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const manifestPath = (file as { path?: unknown }).path;
    if (typeof manifestPath !== "string" || !manifestPath.trim()) continue;
    out.set(runtimeWorkspacePath(manifestPath), manifestPath);
  }
  return out;
}

function runtimeWorkspacePath(manifestPath: string): string {
  const clean = manifestPath.replace(/^\/+/, "");
  if (clean.startsWith("Agent/")) {
    return clean.slice("Agent/".length);
  }
  if (clean.startsWith("User/")) {
    return `User/${clean.slice("User/".length)}`;
  }
  if (clean.startsWith("Thread/")) {
    return `Thread/${clean.slice("Thread/".length)}`;
  }
  if (clean.startsWith("Spaces/")) {
    const [, spaceFolder, ...rest] = clean.split("/");
    return ["Spaces", spaceFolder, rest.join("/")].join("/");
  }
  return clean;
}
