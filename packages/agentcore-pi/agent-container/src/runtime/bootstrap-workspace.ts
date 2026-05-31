/**
 * Workspace bootstrap — flat S3 sync of a scoped workspace prefix to local disk.
 *
 * Per docs/plans/2026-04-27-003 (materialize-at-write-time): the runtime
 * reads one already-materialized S3 prefix. There is no overlay walk, no
 * template fallback, no read-time substitution. Bootstrap is "list the prefix,
 * download every file." Most invocations use the per-thread runtime prefix
 * prepared by the API; legacy invocations fall back to the agent's canonical
 * source prefix.
 *
 * TypeScript port of the Strands `bootstrap_workspace.py` helper —
 * intentionally identical contract so an agent invoked on either runtime
 * sees the same on-disk tree.
 */

import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";

const SKIP_FILES = new Set(["manifest.json", "_defaults_version"]);

export interface BootstrapResult {
  synced: number;
  deleted: number;
  total: number;
  prefix: string;
}

export interface BootstrapWorkspaceOptions {
  workspacePrefix?: string;
}

interface RemoteEntry {
  key: string;
  rel: string;
}

function agentPrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/`;
}

function normalizeRenderedWorkspacePrefix(
  tenantSlug: string,
  agentSlug: string,
  workspacePrefix: string,
): string {
  const trimmed = workspacePrefix.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new Error("rendered_workspace_prefix must be a relative S3 prefix.");
  }

  const normalized = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(
      "rendered_workspace_prefix contains an unsafe path segment.",
    );
  }

  const allowedPrefixes = [`tenants/${tenantSlug}/agents/${agentSlug}/`];
  const threadPrefix = `tenants/${tenantSlug}/threads/`;
  if (
    !allowedPrefixes.some((allowedPrefix) =>
      normalized.startsWith(allowedPrefix),
    ) &&
    !(normalized.startsWith(threadPrefix) && segments.length >= 4)
  ) {
    throw new Error(
      "rendered_workspace_prefix is outside the expected tenant/agent scope.",
    );
  }

  return normalized;
}

function resolveWorkspacePrefix(
  tenantSlug: string,
  agentSlug: string,
  options: BootstrapWorkspaceOptions = {},
): string {
  const scopedPrefix = options.workspacePrefix
    ? normalizeRenderedWorkspacePrefix(
        tenantSlug,
        agentSlug,
        options.workspacePrefix,
      )
    : "";
  return scopedPrefix || agentPrefix(tenantSlug, agentSlug);
}

async function listAgentKeys(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<RemoteEntry[]> {
  const out: RemoteEntry[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = runtimeWorkspacePath(obj.Key.slice(prefix.length));
      if (!rel || SKIP_FILES.has(rel)) continue;
      out.push({ key: obj.Key, rel });
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

function runtimeWorkspacePath(relPath: string): string | null {
  const clean = relPath.replace(/^\/+/, "");
  if (!clean) return null;
  if (isWorkspaceArchivesPath(clean)) return null;

  if (clean.startsWith("Agent/")) {
    const agentPath = stripLegacySourceRoot(clean.slice("Agent/".length));
    if (!agentPath || isWorkspaceArchivesPath(agentPath)) return null;
    return agentPath;
  }
  if (clean.startsWith("User/")) {
    const userPath = stripLegacySourceRoot(clean.slice("User/".length));
    if (!userPath || isWorkspaceArchivesPath(userPath)) return null;
    return userPath;
  }
  if (clean.startsWith("Spaces/")) {
    const [, , ...rest] = clean.split("/");
    if (rest.length === 0) return null;
    const spacePath = stripLegacySourceRoot(rest.join("/"));
    if (!spacePath || isWorkspaceArchivesPath(spacePath)) return null;
    return `Space/${spacePath}`;
  }

  const runtimePath = stripLegacySourceRoot(clean);
  if (!runtimePath || isWorkspaceArchivesPath(runtimePath)) return null;
  return runtimePath;
}

function stripLegacySourceRoot(relPath: string): string {
  let current = relPath;
  while (current.startsWith("source/") || current.startsWith("workspace/")) {
    current = current.replace(/^(source|workspace)\//, "");
  }
  return current;
}

function isWorkspaceArchivesPath(relPath: string): boolean {
  return (
    relPath === "workspace-archives" ||
    relPath.startsWith("workspace-archives/") ||
    relPath === "Agent/workspace-archives" ||
    relPath.startsWith("Agent/workspace-archives/")
  );
}

async function listLocalPaths(localDir: string): Promise<Set<string>> {
  const out = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await walk(abs);
      } else if (st.isFile()) {
        const rel = path.relative(localDir, abs).split(path.sep).join("/");
        out.add(rel);
      }
    }
  }
  await walk(localDir);
  return out;
}

export async function bootstrapWorkspace(
  tenantSlug: string,
  agentSlug: string,
  localDir: string,
  s3: S3Client,
  bucket: string,
  options: BootstrapWorkspaceOptions = {},
): Promise<BootstrapResult> {
  const prefix = resolveWorkspacePrefix(tenantSlug, agentSlug, options);
  const remote = await listAgentKeys(s3, bucket, prefix);
  const remoteSet = new Set(remote.map((entry) => entry.rel));

  await mkdir(localDir, { recursive: true });
  const local = await listLocalPaths(localDir);

  let synced = 0;
  for (const { key, rel } of remote) {
    const localPath = path.join(localDir, rel);
    const parent = path.dirname(localPath);
    if (parent) await mkdir(parent, { recursive: true });
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const body = await resp.Body?.transformToByteArray();
    await writeFile(localPath, body ?? new Uint8Array(0));
    synced++;
  }

  let deleted = 0;
  for (const rel of local) {
    if (remoteSet.has(rel)) continue;
    try {
      await rm(path.join(localDir, rel));
      deleted++;
    } catch {
      // ignore
    }
  }

  // Best-effort orphan-dir cleanup so deletions don't leave empty trees.
  await pruneEmptyDirs(localDir, localDir);

  return { synced, deleted, total: remote.length, prefix };
}

async function pruneEmptyDirs(root: string, dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    const st = await stat(abs);
    if (st.isDirectory()) await pruneEmptyDirs(root, abs);
  }
  if (dir === root) return;
  try {
    const remaining = await readdir(dir);
    if (remaining.length === 0) {
      await rm(dir, { recursive: false });
    }
  } catch {
    // ignore
  }
}

// Test seam — exposes the local-disk reader so unit tests can probe
// without spinning a full sync.
export async function _readLocalForTest(localDir: string): Promise<string[]> {
  const found = await listLocalPaths(localDir);
  return [...found].sort();
}

// Test seam — exposes the file content reader.
export async function _readFileForTest(filePath: string): Promise<string> {
  return (await readFile(filePath)).toString("utf-8");
}
