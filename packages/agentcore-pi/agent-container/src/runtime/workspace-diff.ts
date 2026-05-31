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
  const [snapshot, hydrateManifest] = await Promise.all([
    readLocalWorkspaceSnapshot(input.workspaceDir, input.log),
    readHydrateManifest(input.workspaceDir, input.log),
  ]);
  return buildWorkspaceBaseline({ snapshot, hydrateManifest });
}

export async function collectLocalWorkspaceChangedFiles(input: {
  workspaceDir: string;
  baseline?: WorkspaceBaseline;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}): Promise<FinalizeChangedFile[]> {
  if (!input.baseline) return [];
  return computeWorkspaceChangedFiles({
    baseline: input.baseline,
    current: await readLocalWorkspaceSnapshot(input.workspaceDir, input.log),
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
      files[
        path.relative(workspaceDir, absolutePath).split(path.sep).join("/")
      ] = new TextDecoder().decode(bytes);
    }
  }
  await visit(workspaceDir);
  return files;
}
