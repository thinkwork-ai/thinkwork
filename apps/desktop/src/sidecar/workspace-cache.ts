import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const CACHE_MANIFEST_FILE = ".thinkwork-workspace-cache.json";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Directory under Electron `userData` that holds the synced Pi workspace cache.
 * Single source of truth shared by the sidecar (writer) and the Local Workspace
 * inspector (reader) so the two never drift onto divergent paths.
 */
export const WORKSPACE_CACHE_DIRNAME = "pi-workspaces";

/**
 * Sidecar-internal sentinel files that are never workspace content. Exported so
 * the read-only inspector filters exactly what the writer skips.
 */
export const SKIP_FILES = new Set([
  "manifest.json",
  "_defaults_version",
  CACHE_MANIFEST_FILE,
]);
const MAX_CACHE_PARTITIONS = 12;

export interface WorkspaceCachePartition {
  stage: string;
  tenantSlug: string;
  agentSlug: string;
  spaceId: string;
  userId: string;
}

export interface WorkspaceRemoteObject {
  key: string;
  eTag?: string;
  size?: number;
  lastModified?: string;
}

export interface WorkspaceObjectStore {
  listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<WorkspaceRemoteObject[]>;
  getObjectBytes(input: { bucket: string; key: string }): Promise<Uint8Array>;
}

export interface WorkspaceSyncInput {
  bucket: string;
  renderedPrefix: string;
  partition: WorkspaceCachePartition;
}

export interface WorkspaceSyncResult {
  localDir: string;
  prefix: string;
  synced: number;
  deleted: number;
  total: number;
  cacheHit?: boolean;
  cacheStale?: boolean;
}

export interface WorkspaceCacheOptions {
  cacheTtlMs?: number;
  now?: () => Date;
  backgroundRefresh?: (refresh: () => Promise<void>) => void;
  onBackgroundRefreshError?: (err: unknown) => void;
}

interface WorkspaceCacheManifest {
  prefix: string;
  syncedAt: string;
  total: number;
  objects?: Record<string, string>;
}

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export class WorkspaceCache {
  constructor(
    private readonly rootDir: string,
    private readonly store: WorkspaceObjectStore = createS3WorkspaceObjectStore(),
    private readonly options: WorkspaceCacheOptions = {},
  ) {}

  async sync(input: WorkspaceSyncInput): Promise<WorkspaceSyncResult> {
    const prefix = normalizeRenderedWorkspacePrefix(
      input.partition.tenantSlug,
      input.partition.agentSlug,
      input.renderedPrefix,
    );
    const localDir = this.partitionPath(input.partition);
    await mkdir(localDir, { recursive: true });

    const cached = isThreadRuntimePrefix(input.partition.tenantSlug, prefix)
      ? null
      : await this.readFreshCacheManifest(localDir, prefix);
    if (cached) {
      await this.evictOldPartitions(input.partition.stage);
      return {
        localDir,
        prefix,
        synced: 0,
        deleted: 0,
        total: cached.total,
        cacheHit: true,
      };
    }

    const staleManifest = isThreadRuntimePrefix(
      input.partition.tenantSlug,
      prefix,
    )
      ? null
      : await this.readCacheManifest(localDir, prefix);
    if (staleManifest && (await hasLocalWorkspaceFiles(localDir))) {
      this.refreshInBackground(input, localDir, prefix);
      await this.evictOldPartitions(input.partition.stage);
      return {
        localDir,
        prefix,
        synced: 0,
        deleted: 0,
        total: staleManifest.total,
        cacheHit: true,
        cacheStale: true,
      };
    }

    return this.refreshFromRemote(input, localDir, prefix);
  }

  private async refreshFromRemote(
    input: WorkspaceSyncInput,
    localDir: string,
    prefix: string,
  ): Promise<WorkspaceSyncResult> {
    const remote = await this.store.listObjects({
      bucket: input.bucket,
      prefix,
    });
    const remoteEntries = remote
      .filter((obj) => obj.key.startsWith(prefix))
      .map((obj) => ({
        key: obj.key,
        rel: obj.key.slice(prefix.length),
        signature: remoteObjectSignature(obj),
      }))
      .filter(({ rel }) => rel && !SKIP_FILES.has(rel));
    const remoteSet = new Set(remoteEntries.map(({ rel }) => rel));

    let synced = 0;
    const priorObjects =
      (await this.readCacheManifest(localDir, prefix))?.objects ?? {};
    const nextObjects: Record<string, string> = {};
    for (const { key, rel, signature } of remoteEntries) {
      assertSafeRelativePath(rel);
      const localPath = path.join(localDir, rel);
      nextObjects[rel] = signature;
      if (priorObjects[rel] === signature && (await fileExists(localPath))) {
        continue;
      }
      await mkdir(path.dirname(localPath), { recursive: true });
      const bytes = await this.store.getObjectBytes({
        bucket: input.bucket,
        key,
      });
      await writeFile(localPath, bytes);
      synced++;
    }

    let deleted = 0;
    for (const rel of await listLocalFiles(localDir)) {
      if (rel === CACHE_MANIFEST_FILE) continue;
      if (remoteSet.has(rel)) continue;
      await rm(path.join(localDir, rel), { force: true });
      deleted++;
    }
    await pruneEmptyDirs(localDir, localDir);
    await this.writeManifest(localDir, {
      prefix,
      syncedAt: (this.options.now?.() ?? new Date()).toISOString(),
      total: remoteEntries.length,
      objects: nextObjects,
    });
    await this.evictOldPartitions(input.partition.stage);

    return { localDir, prefix, synced, deleted, total: remoteEntries.length };
  }

  private refreshInBackground(
    input: WorkspaceSyncInput,
    localDir: string,
    prefix: string,
  ): void {
    const refresh = async () => {
      await this.refreshFromRemote(input, localDir, prefix);
    };
    const run = this.options.backgroundRefresh;
    if (run) {
      run(refresh);
      return;
    }
    void refresh().catch((err) => {
      this.options.onBackgroundRefreshError?.(err);
    });
  }

  partitionPath(partition: WorkspaceCachePartition): string {
    return path.join(
      this.rootDir,
      safeSegment(partition.stage),
      safeSegment(partition.tenantSlug),
      safeSegment(partition.agentSlug),
      safeSegment(partition.spaceId),
      safeSegment(partition.userId),
    );
  }

  private async evictOldPartitions(stage: string): Promise<void> {
    const stageDir = path.join(this.rootDir, safeSegment(stage));
    let entries: string[];
    try {
      entries = await readdir(stageDir);
    } catch {
      return;
    }
    const tenants = await Promise.all(
      entries.map(async (entry) => {
        const abs = path.join(stageDir, entry);
        return { abs, mtimeMs: (await stat(abs)).mtimeMs };
      }),
    );
    tenants.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of tenants.slice(MAX_CACHE_PARTITIONS)) {
      await rm(stale.abs, { recursive: true, force: true });
    }
  }

  private async readFreshCacheManifest(
    localDir: string,
    prefix: string,
  ): Promise<WorkspaceCacheManifest | null> {
    const cacheTtlMs = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (cacheTtlMs <= 0) return null;

    const manifest = await this.readCacheManifest(localDir, prefix);
    if (!manifest) return null;
    const syncedAt = Date.parse(manifest.syncedAt);
    if (!Number.isFinite(syncedAt)) return null;
    const ageMs = (this.options.now?.() ?? new Date()).getTime() - syncedAt;
    if (ageMs < 0 || ageMs > cacheTtlMs) return null;

    const files = await listLocalFiles(localDir);
    files.delete(CACHE_MANIFEST_FILE);
    return files.size > 0 ? manifest : null;
  }

  private async readCacheManifest(
    localDir: string,
    prefix: string,
  ): Promise<WorkspaceCacheManifest | null> {
    let manifest: WorkspaceCacheManifest;
    try {
      manifest = JSON.parse(
        await readFile(path.join(localDir, CACHE_MANIFEST_FILE), "utf8"),
      ) as WorkspaceCacheManifest;
    } catch {
      return null;
    }
    if (manifest.prefix !== prefix || !Number.isFinite(manifest.total)) {
      return null;
    }
    return manifest;
  }

  private async writeManifest(
    localDir: string,
    manifest: WorkspaceCacheManifest,
  ): Promise<void> {
    await writeFile(
      path.join(localDir, CACHE_MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }
}

export function normalizeRenderedWorkspacePrefix(
  tenantSlug: string,
  agentSlug: string,
  workspacePrefix: string,
): string {
  const trimmed = workspacePrefix.trim();
  if (!trimmed) {
    throw new WorkspaceBoundaryError("rendered_workspace_prefix is required");
  }
  if (trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new WorkspaceBoundaryError(
      "rendered_workspace_prefix must be a relative S3 prefix",
    );
  }
  const normalized = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  for (const segment of normalized.split("/").filter(Boolean)) {
    if (segment === "." || segment === "..") {
      throw new WorkspaceBoundaryError(
        "rendered_workspace_prefix contains an unsafe path segment",
      );
    }
  }
  const allowedPrefixes = [
    `tenants/${tenantSlug}/rendered/${agentSlug}/`,
    `tenants/${tenantSlug}/threads/`,
  ];
  if (
    !allowedPrefixes.some((allowedPrefix) =>
      normalized.startsWith(allowedPrefix),
    )
  ) {
    throw new WorkspaceBoundaryError(
      "rendered_workspace_prefix is outside the expected tenant/agent scope",
    );
  }
  return normalized;
}

function isThreadRuntimePrefix(tenantSlug: string, prefix: string): boolean {
  return prefix.startsWith(`tenants/${tenantSlug}/threads/`);
}

export function createS3WorkspaceObjectStore(
  config: S3ClientConfig = {},
): WorkspaceObjectStore {
  const client = new S3Client(config);
  return {
    async listObjects(input) {
      const out: WorkspaceRemoteObject[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of response.Contents ?? []) {
          if (obj.Key) {
            out.push({
              key: obj.Key,
              eTag: obj.ETag,
              size: obj.Size,
              lastModified: obj.LastModified?.toISOString(),
            });
          }
        }
        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return out;
    },
    async getObjectBytes(input) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return response.Body?.transformToByteArray() ?? new Uint8Array(0);
    },
  };
}

async function listLocalFiles(localDir: string): Promise<Set<string>> {
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
        out.add(path.relative(localDir, abs).split(path.sep).join("/"));
      }
    }
  }
  await walk(localDir);
  return out;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function hasLocalWorkspaceFiles(localDir: string): Promise<boolean> {
  const files = await listLocalFiles(localDir);
  files.delete(CACHE_MANIFEST_FILE);
  return files.size > 0;
}

function remoteObjectSignature(obj: WorkspaceRemoteObject): string {
  return [
    obj.key,
    obj.eTag ?? "",
    Number.isFinite(obj.size) ? String(obj.size) : "",
    obj.lastModified ?? "",
  ].join("\t");
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
    if ((await stat(abs)).isDirectory()) await pruneEmptyDirs(root, abs);
  }
  if (dir === root) return;
  try {
    if ((await readdir(dir)).length === 0) await rm(dir);
  } catch {
    // Best-effort cleanup only.
  }
}

function assertSafeRelativePath(rel: string): void {
  if (rel.startsWith("/") || rel.includes("\\") || path.isAbsolute(rel)) {
    throw new WorkspaceBoundaryError("workspace object key is not relative");
  }
  if (rel.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new WorkspaceBoundaryError("workspace object key is unsafe");
  }
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new WorkspaceBoundaryError("workspace cache partition is invalid");
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}
