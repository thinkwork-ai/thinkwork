import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildWorkspaceBaseline,
  computeWorkspaceChangedFiles,
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
    return stripLegacySourceRoot(clean.slice("Agent/".length));
  }
  if (clean.startsWith("User/")) {
    return `User/${stripLegacySourceRoot(clean.slice("User/".length))}`;
  }
  if (clean.startsWith("Thread/")) {
    return `Thread/${stripLegacySourceRoot(clean.slice("Thread/".length))}`;
  }
  if (clean.startsWith("Spaces/")) {
    if (clean === "Spaces/INDEX.md") return clean;
    const [, spaceFolder, ...rest] = clean.split("/");
    return ["Spaces", spaceFolder, stripLegacySourceRoot(rest.join("/"))].join(
      "/",
    );
  }
  return stripLegacySourceRoot(clean);
}

function stripLegacySourceRoot(relativePath: string): string {
  let current = relativePath;
  while (current.startsWith("source/") || current.startsWith("workspace/")) {
    current = current.replace(/^(source|workspace)\//, "");
  }
  return current;
}
