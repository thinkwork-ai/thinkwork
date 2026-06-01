/**
 * Workspace bootstrap — flat S3 sync of a scoped workspace prefix to local disk.
 *
 * Per docs/plans/2026-04-27-003 (materialize-at-write-time): the runtime
 * reads one already-materialized S3 prefix. Most invocations use a per-thread
 * runtime prefix prepared by the API. That prefix carries a hydrate manifest
 * whose entries point back to the Agent/User/Space source objects so the
 * runtime can copy the tuple into the local bash workspace without duplicating
 * every source object in S3. Legacy invocations fall back to listing and
 * downloading the agent's canonical source prefix directly.
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
const HYDRATE_MANIFEST_PATH = ".hydrate_manifest.json";
const RENDERED_MARKER_PATH = ".rendered_at";

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

interface HydrateManifestFile {
  path?: unknown;
  sourceKey?: unknown;
}

interface HydrateManifestStatusMount {
  path?: unknown;
  available?: unknown;
  sourceKey?: unknown;
}

interface HydrateManifest {
  files?: unknown;
  statusMounts?: unknown;
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
  const listed = await listObjects(s3, bucket, prefix);
  const manifestObject = listed.find(
    (object) => object.rel === HYDRATE_MANIFEST_PATH,
  );
  if (manifestObject) {
    const manifestText = (
      await readRemoteBytes(s3, bucket, manifestObject.key)
    ).toString("utf8");
    return remoteEntriesFromManifest(manifestText);
  }

  return listed
    .map((object) => {
      const rel = runtimeWorkspacePath(object.rel);
      return rel && !SKIP_FILES.has(rel) ? { key: object.key, rel } : null;
    })
    .filter((entry): entry is RemoteEntry => entry !== null);
}

async function listObjects(
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
      out.push({ key: obj.Key, rel: obj.Key.slice(prefix.length) });
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

function remoteEntriesFromManifest(manifestText: string): RemoteEntry[] {
  const parsed = JSON.parse(manifestText) as HydrateManifest;
  const entries = new Map<string, RemoteEntry>();
  const files = Array.isArray(parsed.files)
    ? (parsed.files as HydrateManifestFile[])
    : [];
  for (const file of files) {
    addManifestEntry(entries, file);
  }
  const statusMounts = Array.isArray(parsed.statusMounts)
    ? (parsed.statusMounts as HydrateManifestStatusMount[])
    : [];
  for (const mount of statusMounts) {
    if (mount.available === true) addManifestEntry(entries, mount);
  }
  return [...entries.values()];
}

function addManifestEntry(
  entries: Map<string, RemoteEntry>,
  file: HydrateManifestFile | HydrateManifestStatusMount,
): void {
  if (typeof file.path !== "string" || typeof file.sourceKey !== "string") {
    return;
  }
  const rel = runtimeWorkspacePath(file.path);
  if (!rel || SKIP_FILES.has(rel)) return;
  entries.set(rel, { key: file.sourceKey, rel });
}

function runtimeWorkspacePath(relPath: string): string | null {
  const clean = relPath.replace(/^\/+/, "");
  if (!clean) return null;
  if (clean === HYDRATE_MANIFEST_PATH || clean === RENDERED_MARKER_PATH) {
    return null;
  }
  if (isWorkspaceArchivesPath(clean)) return null;

  if (clean.startsWith("Agent/")) {
    const agentPath = clean.slice("Agent/".length);
    if (!agentPath || isWorkspaceArchivesPath(agentPath)) return null;
    return agentPath;
  }
  if (clean.startsWith("User/")) {
    const userPath = clean.slice("User/".length);
    if (!userPath || isWorkspaceArchivesPath(userPath)) return null;
    return `User/${userPath}`;
  }
  if (clean.startsWith("Thread/")) {
    const threadPath = clean.slice("Thread/".length);
    if (!threadPath || isWorkspaceArchivesPath(threadPath)) return null;
    return `Thread/${threadPath}`;
  }
  if (clean.startsWith("Spaces/")) {
    if (clean === "Spaces/INDEX.md") return clean;
    const [, spaceFolder, ...rest] = clean.split("/");
    if (rest.length === 0) return null;
    const spacePath = rest.join("/");
    if (!spacePath || isWorkspaceArchivesPath(spacePath)) return null;
    return `Spaces/${spaceFolder}/${spacePath}`;
  }

  const runtimePath = clean;
  if (!runtimePath || isWorkspaceArchivesPath(runtimePath)) return null;
  return runtimePath;
}

function isWorkspaceArchivesPath(relPath: string): boolean {
  return (
    relPath === "workspace-archives" ||
    relPath.startsWith("workspace-archives/") ||
    relPath === "Agent/workspace-archives" ||
    relPath.startsWith("Agent/workspace-archives/") ||
    relPath === "source" ||
    relPath.startsWith("source/") ||
    relPath === "workspace" ||
    relPath.startsWith("workspace/")
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
    await writeFile(localPath, await readRemoteBytes(s3, bucket, key));
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

async function readRemoteBytes(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await resp.Body?.transformToByteArray();
  return Buffer.from(body ?? new Uint8Array(0));
}
