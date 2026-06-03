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
 * Pi workspace bootstrap keeps the same flat S3 sync contract older
 * runtimes used so existing rendered workspace prefixes hydrate to the same
 * on-disk tree.
 */

import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
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
  skipped?: number;
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
  etag?: string;
  manifestEtag?: string;
  manifestFingerprint?: string;
}

interface HydrateManifestFile {
  path?: unknown;
  sourceKey?: unknown;
  etag?: unknown;
}

interface HydrateManifestStatusMount {
  path?: unknown;
  available?: unknown;
  sourceKey?: unknown;
  etag?: unknown;
}

interface HydrateManifest {
  files?: unknown;
  statusMounts?: unknown;
}

interface HydrateCacheEntry {
  sourceKey: string;
  etag: string;
  manifestEtag?: string;
  manifestFingerprint?: string;
}

interface HydrateCache {
  tenantSlug: string;
  agentSlug: string;
  prefix: string;
  entries: Record<string, HydrateCacheEntry>;
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
    return remoteEntriesFromManifest(manifestText, {
      manifestEtag: manifestObject.etag,
      manifestFingerprint: sha256(manifestText),
    });
  }

  return listed.flatMap((object): RemoteEntry[] => {
    const rel = runtimeWorkspacePath(object.rel);
    return rel && !SKIP_FILES.has(rel)
      ? [{ key: object.key, rel, etag: object.etag }]
      : [];
  });
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
      out.push({
        key: obj.Key,
        rel: obj.Key.slice(prefix.length),
        etag: obj.ETag,
      });
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

function remoteEntriesFromManifest(
  manifestText: string,
  manifestIdentity: {
    manifestEtag?: string;
    manifestFingerprint: string;
  },
): RemoteEntry[] {
  const parsed = JSON.parse(manifestText) as HydrateManifest;
  const entries = new Map<string, RemoteEntry>();
  const files = Array.isArray(parsed.files)
    ? (parsed.files as HydrateManifestFile[])
    : [];
  for (const file of files) {
    addManifestEntry(entries, file, manifestIdentity);
  }
  const statusMounts = Array.isArray(parsed.statusMounts)
    ? (parsed.statusMounts as HydrateManifestStatusMount[])
    : [];
  for (const mount of statusMounts) {
    if (mount.available === true) {
      addManifestEntry(entries, mount, manifestIdentity);
    }
  }
  return [...entries.values()];
}

function addManifestEntry(
  entries: Map<string, RemoteEntry>,
  file: HydrateManifestFile | HydrateManifestStatusMount,
  manifestIdentity: {
    manifestEtag?: string;
    manifestFingerprint: string;
  },
): void {
  if (typeof file.path !== "string" || typeof file.sourceKey !== "string") {
    return;
  }
  const rel = runtimeWorkspacePath(file.path);
  if (!rel || SKIP_FILES.has(rel)) return;
  entries.set(rel, {
    key: file.sourceKey,
    rel,
    etag: typeof file.etag === "string" ? file.etag : undefined,
    manifestEtag: manifestIdentity.manifestEtag,
    manifestFingerprint: manifestIdentity.manifestFingerprint,
  });
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
  const cachePath = await hydrateCachePath(localDir);
  const cache = await readHydrateCache(cachePath);

  let synced = 0;
  let skipped = 0;
  for (const entry of remote) {
    const { key, rel } = entry;
    const localPath = path.join(localDir, rel);
    if (
      local.has(rel) &&
      hydrateCacheEntryMatches(cache, {
        tenantSlug,
        agentSlug,
        prefix,
        entry,
      })
    ) {
      skipped++;
      continue;
    }
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

  await writeHydrateCache(cachePath, {
    tenantSlug,
    agentSlug,
    prefix,
    entries: cacheEntriesFor(remote),
  });

  return {
    synced,
    ...(skipped > 0 ? { skipped } : {}),
    deleted,
    total: remote.length,
    prefix,
  };
}

async function hydrateCachePath(localDir: string): Promise<string> {
  try {
    return `${await realpath(localDir)}.hydrate-cache.json`;
  } catch {
    return `${localDir}.hydrate-cache.json`;
  }
}

async function readHydrateCache(
  filePath: string,
): Promise<HydrateCache | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.tenantSlug === "string" &&
      typeof parsed.agentSlug === "string" &&
      typeof parsed.prefix === "string" &&
      parsed.entries &&
      typeof parsed.entries === "object"
    ) {
      return parsed as HydrateCache;
    }
  } catch {
    // Missing or malformed cache metadata should never block a turn.
  }
  return null;
}

async function writeHydrateCache(
  filePath: string,
  cache: HydrateCache,
): Promise<void> {
  try {
    await writeFile(filePath, JSON.stringify(cache));
  } catch {
    // Best-effort optimization only.
  }
}

function hydrateCacheEntryMatches(
  cache: HydrateCache | null,
  input: {
    tenantSlug: string;
    agentSlug: string;
    prefix: string;
    entry: RemoteEntry;
  },
): boolean {
  if (
    !cache ||
    cache.tenantSlug !== input.tenantSlug ||
    cache.agentSlug !== input.agentSlug ||
    cache.prefix !== input.prefix
  ) {
    return false;
  }
  const entryFingerprint = input.entry.etag;
  if (!entryFingerprint) return false;
  const cached = cache.entries[input.entry.rel];
  return Boolean(
    cached &&
    cached.sourceKey === input.entry.key &&
    cached.etag === entryFingerprint,
  );
}

function cacheEntriesFor(
  remote: RemoteEntry[],
): Record<string, HydrateCacheEntry> {
  const entries: Record<string, HydrateCacheEntry> = {};
  for (const entry of remote) {
    if (!entry.etag) continue;
    entries[entry.rel] = {
      sourceKey: entry.key,
      etag: entry.etag,
      manifestEtag: entry.manifestEtag,
      manifestFingerprint: entry.manifestFingerprint,
    };
  }
  return entries;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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
