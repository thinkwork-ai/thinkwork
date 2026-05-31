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
const HYDRATE_MANIFEST_FILE = ".hydrate_manifest.json";
const RENDERED_AT_FILE = ".rendered_at";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_OFFLINE_EXECUTION_TTL_MS = 15 * 60 * 1000;

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
  accessRevalidated?: boolean;
}

export interface WorkspaceCacheOptions {
  cacheTtlMs?: number;
  offlineExecutionTtlMs?: number;
  now?: () => Date;
  backgroundRefresh?: (refresh: () => Promise<void>) => void;
  onBackgroundRefreshError?: (err: unknown) => void;
}

interface WorkspaceCacheManifest {
  prefix: string;
  syncedAt: string;
  accessValidatedAt?: string;
  total: number;
  objects?: Record<string, string>;
}

interface WorkspaceHydrateManifestFile {
  path?: unknown;
  sourceKey?: unknown;
  etag?: unknown;
  size?: unknown;
  lastModified?: unknown;
}

interface WorkspaceHydrateManifestStatusMount {
  path?: unknown;
  sourceKey?: unknown;
  etag?: unknown;
  size?: unknown;
  lastModified?: unknown;
  available?: unknown;
}

interface WorkspaceHydrateManifestSource {
  owner?: unknown;
  prefix?: unknown;
}

interface WorkspaceHydrateManifest {
  version?: unknown;
  sources?: WorkspaceHydrateManifestSource[];
  files?: WorkspaceHydrateManifestFile[];
  statusMounts?: WorkspaceHydrateManifestStatusMount[];
}

interface RemoteEntry {
  key: string;
  rel: string;
  signature: string;
  bytes?: Uint8Array;
}

export interface WorkspaceRevocationInput {
  stage: string;
  tenantSlug: string;
  spaceId: string;
  agentSlug?: string | null;
  userId?: string | null;
}

export interface WorkspaceWipeResult {
  deleted: number;
}

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export class WorkspaceAccessRevalidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessRevalidationError";
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

    const now = this.options.now?.() ?? new Date();
    const cached = isThreadRuntimePrefix(input.partition.tenantSlug, prefix)
      ? null
      : await this.readFreshCacheManifest(localDir, prefix, now);
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
    const hasStaleLocalFiles =
      Boolean(staleManifest) && (await hasLocalWorkspaceFiles(localDir));
    if (
      staleManifest &&
      hasStaleLocalFiles &&
      !this.isOfflineExecutionExpired(staleManifest, now)
    ) {
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

    try {
      return await this.refreshFromRemote(input, localDir, prefix);
    } catch (err) {
      if (
        staleManifest &&
        hasStaleLocalFiles &&
        this.isOfflineExecutionExpired(staleManifest, now)
      ) {
        throw new WorkspaceAccessRevalidationError(
          "Workspace access revalidation is required before using this cached Space.",
        );
      }
      throw err;
    }
  }

  async wipeRevokedSpace(
    input: WorkspaceRevocationInput,
  ): Promise<WorkspaceWipeResult> {
    void input;
    if (!(await directoryExists(this.rootDir))) return { deleted: 0 };
    await rm(this.rootDir, { recursive: true, force: true });
    return { deleted: 1 };
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
    const remoteEntries = await this.remoteEntriesForHydration({
      bucket: input.bucket,
      prefix,
      remote,
    });
    const remoteSet = new Set(remoteEntries.map(({ rel }) => rel));

    let synced = 0;
    const priorObjects =
      (await this.readCacheManifest(localDir, prefix))?.objects ??
      (await this.readAnyCacheManifest(localDir))?.objects ??
      {};
    const nextObjects: Record<string, string> = {};
    for (const { key, rel, signature, bytes: cachedBytes } of remoteEntries) {
      assertSafeRelativePath(rel);
      const localPath = path.join(localDir, rel);
      nextObjects[rel] = signature;
      if (priorObjects[rel] === signature && (await fileExists(localPath))) {
        continue;
      }
      await mkdir(path.dirname(localPath), { recursive: true });
      const bytes =
        cachedBytes ??
        (await this.store.getObjectBytes({
          bucket: input.bucket,
          key,
        }));
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
    const validatedAt = (this.options.now?.() ?? new Date()).toISOString();
    await this.writeManifest(localDir, {
      prefix,
      syncedAt: validatedAt,
      accessValidatedAt: validatedAt,
      total: remoteEntries.length,
      objects: nextObjects,
    });
    await this.evictOldPartitions(input.partition.stage);

    return {
      localDir,
      prefix,
      synced,
      deleted,
      total: remoteEntries.length,
      accessRevalidated: true,
    };
  }

  private async remoteEntriesForHydration(input: {
    bucket: string;
    prefix: string;
    remote: WorkspaceRemoteObject[];
  }): Promise<RemoteEntry[]> {
    const manifestObject = input.remote.find(
      (object) => object.key === `${input.prefix}${HYDRATE_MANIFEST_FILE}`,
    );
    if (manifestObject) {
      const manifestBytes = await this.store.getObjectBytes({
        bucket: input.bucket,
        key: manifestObject.key,
      });
      const manifest = parseHydrateManifest(manifestBytes);
      if (manifest) {
        const normalizedManifest = normalizeHydrateManifestForDesktop(manifest);
        const entriesByRel = new Map<string, RemoteEntry>();
        const addEntry = (entry: RemoteEntry) => {
          entriesByRel.set(entry.rel, entry);
        };
        for (const file of normalizedManifest.files ?? []) {
          const rel = stringValue(file.path);
          const key = stringValue(file.sourceKey);
          if (!rel || !key) continue;
          addEntry({
            key,
            rel,
            signature: manifestObjectSignature(key, file),
          });
        }
        for (const mount of normalizedManifest.statusMounts ?? []) {
          if (mount.available === false) continue;
          const rel = stringValue(mount.path);
          const key = stringValue(mount.sourceKey);
          if (!rel || !key) continue;
          addEntry({
            key,
            rel,
            signature: manifestObjectSignature(key, mount),
          });
        }
        for (const entry of await this.sourceEntriesForHydrationManifest({
          bucket: input.bucket,
          manifest: normalizedManifest,
        })) {
          addEntry(entry.remoteEntry);
          ensureManifestFile(normalizedManifest, entry.manifestFile);
        }
        const normalizedManifestBytes = new TextEncoder().encode(
          `${JSON.stringify(normalizedManifest, null, 2)}\n`,
        );
        addEntry({
          key: manifestObject.key,
          rel: HYDRATE_MANIFEST_FILE,
          signature: remoteObjectSignature(manifestObject),
          bytes: normalizedManifestBytes,
        });
        return Array.from(entriesByRel.values()).sort((left, right) =>
          left.rel.localeCompare(right.rel),
        );
      }
    }

    return input.remote
      .filter((obj) => obj.key.startsWith(input.prefix))
      .map((obj) => ({
        key: obj.key,
        rel: obj.key.slice(input.prefix.length),
        signature: remoteObjectSignature(obj),
      }))
      .filter(
        ({ rel }) => rel && !SKIP_FILES.has(rel) && rel !== RENDERED_AT_FILE,
      );
  }

  private async sourceEntriesForHydrationManifest(input: {
    bucket: string;
    manifest: WorkspaceHydrateManifest;
  }): Promise<
    Array<{
      remoteEntry: RemoteEntry;
      manifestFile: WorkspaceHydrateManifestFile & {
        owner: string;
        sourcePrefix: string;
        sourcePath: string;
        readOnly: false;
      };
    }>
  > {
    const out: Array<{
      remoteEntry: RemoteEntry;
      manifestFile: WorkspaceHydrateManifestFile & {
        owner: string;
        sourcePrefix: string;
        sourcePath: string;
        readOnly: false;
      };
    }> = [];
    const sources = normalizedHydrateSources(input.manifest);
    let hasUserSourceEntries = false;
    for (const source of sources) {
      const listPrefix =
        source.owner === "space"
          ? (tenantSpacesPrefix(source.prefix) ?? source.prefix)
          : source.prefix;
      const objects = await this.store.listObjects({
        bucket: input.bucket,
        prefix: listPrefix,
      });
      for (const object of objects) {
        const mapped = desktopHydratePathForSourceObject({
          owner: source.owner,
          sourcePrefix: listPrefix,
          key: object.key,
        });
        if (!mapped) continue;
        if (source.owner === "user") hasUserSourceEntries = true;
        out.push({
          remoteEntry: {
            key: object.key,
            rel: mapped.path,
            signature: remoteObjectSignature(object),
          },
          manifestFile: {
            path: mapped.path,
            owner: source.owner,
            sourceKey: object.key,
            sourcePrefix: mapped.sourcePrefix,
            sourcePath: mapped.sourcePath,
            lastModified: object.lastModified,
            etag: object.eTag,
            size: object.size,
            readOnly: false,
          },
        });
      }
    }
    if (!hasUserSourceEntries) {
      const userSource = sources.find((source) => source.owner === "user");
      const legacyPrefix = legacyRenderedUserWorkspacePrefix(input.manifest);
      if (userSource && legacyPrefix) {
        const objects = await this.store.listObjects({
          bucket: input.bucket,
          prefix: legacyPrefix,
        });
        for (const object of objects) {
          const mapped = legacyRenderedUserHydrateEntry({
            object,
            legacyPrefix,
            userSourcePrefix: userSource.prefix,
          });
          if (mapped) out.push(mapped);
        }
      }
    }
    return out;
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
    void partition;
    return this.rootDir;
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
    now: Date,
  ): Promise<WorkspaceCacheManifest | null> {
    const cacheTtlMs = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (cacheTtlMs <= 0) return null;

    const manifest = await this.readCacheManifest(localDir, prefix);
    if (!manifest) return null;
    if (this.isOfflineExecutionExpired(manifest, now)) return null;
    const syncedAt = Date.parse(manifest.syncedAt);
    if (!Number.isFinite(syncedAt)) return null;
    const ageMs = now.getTime() - syncedAt;
    if (ageMs < 0 || ageMs > cacheTtlMs) return null;

    const files = await listLocalFiles(localDir);
    files.delete(CACHE_MANIFEST_FILE);
    return files.size > 0 ? manifest : null;
  }

  private isOfflineExecutionExpired(
    manifest: WorkspaceCacheManifest,
    now: Date,
  ): boolean {
    const ttlMs =
      this.options.offlineExecutionTtlMs ?? DEFAULT_OFFLINE_EXECUTION_TTL_MS;
    if (ttlMs <= 0) return true;
    const validatedAt = Date.parse(
      manifest.accessValidatedAt ?? manifest.syncedAt,
    );
    if (!Number.isFinite(validatedAt)) return true;
    const ageMs = now.getTime() - validatedAt;
    return ageMs < 0 || ageMs > ttlMs;
  }

  private async readCacheManifest(
    localDir: string,
    prefix: string,
  ): Promise<WorkspaceCacheManifest | null> {
    const manifest = await this.readAnyCacheManifest(localDir);
    if (!manifest) return null;
    if (manifest.prefix !== prefix || !Number.isFinite(manifest.total)) {
      return null;
    }
    return manifest;
  }

  private async readAnyCacheManifest(
    localDir: string,
  ): Promise<WorkspaceCacheManifest | null> {
    let manifest: WorkspaceCacheManifest;
    try {
      manifest = JSON.parse(
        await readFile(path.join(localDir, CACHE_MANIFEST_FILE), "utf8"),
      ) as WorkspaceCacheManifest;
    } catch {
      return null;
    }
    return Number.isFinite(manifest.total) ? manifest : null;
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
  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new WorkspaceBoundaryError(
        "rendered_workspace_prefix contains an unsafe path segment",
      );
    }
  }
  const allowedPrefixes = [`tenants/${tenantSlug}/agents/${agentSlug}/`];
  const threadPrefix = `tenants/${tenantSlug}/threads/`;
  if (
    !allowedPrefixes.some((allowedPrefix) =>
      normalized.startsWith(allowedPrefix),
    ) &&
    !(normalized.startsWith(threadPrefix) && segments.length >= 4)
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

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
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

function shouldHydrateSourcePath(relPath: string): boolean {
  if (!relPath || relPath === RENDERED_AT_FILE) return false;
  if (isWorkspaceArchivesPath(relPath)) return false;
  const base = relPath.split("/").pop() ?? relPath;
  return (
    !SKIP_FILES.has(base) &&
    base !== HYDRATE_MANIFEST_FILE &&
    base !== ".gitkeep"
  );
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
    relPath.startsWith("Agent/workspace-archives/") ||
    relPath === "Spaces/workspace-archives" ||
    relPath.startsWith("Spaces/workspace-archives/")
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseHydrateManifest(
  bytes: Uint8Array,
): WorkspaceHydrateManifest | null {
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as WorkspaceHydrateManifest;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeHydrateManifestForDesktop(
  manifest: WorkspaceHydrateManifest,
): WorkspaceHydrateManifest {
  const spaceFolder = workspaceFolderFromManifest(manifest);
  return {
    ...manifest,
    files: (manifest.files ?? []).map((file) => ({
      ...file,
      path: desktopHydratePath({
        owner: stringValue((file as { owner?: unknown }).owner),
        path: stringValue(file.path),
        sourcePath: stringValue((file as { sourcePath?: unknown }).sourcePath),
        spaceFolder,
      }),
    })),
    statusMounts: (manifest.statusMounts ?? []).map((mount) => ({
      ...mount,
      path: desktopHydratePath({
        owner: "system",
        path: stringValue(mount.path),
        sourcePath: stringValue(mount.path),
        spaceFolder,
      }),
    })),
  };
}

function workspaceFolderFromManifest(
  manifest: WorkspaceHydrateManifest,
): string {
  const source = (
    manifest as { sources?: Array<{ owner?: unknown; prefix?: unknown }> }
  ).sources?.find((candidate) => candidate.owner === "space");
  const prefix = stringValue(source?.prefix);
  const match = prefix?.match(/\/spaces\/([^/]+)\//);
  return match?.[1] ?? "default";
}

function normalizedHydrateSources(
  manifest: WorkspaceHydrateManifest,
): Array<{ owner: "agent" | "space" | "user"; prefix: string }> {
  const out: Array<{ owner: "agent" | "space" | "user"; prefix: string }> = [];
  const seen = new Set<string>();
  for (const source of manifest.sources ?? []) {
    const owner = stringValue(source.owner);
    if (owner !== "agent" && owner !== "space" && owner !== "user") continue;
    const rawPrefix = stringValue(source.prefix);
    if (!rawPrefix) continue;
    const prefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;
    const key = `${owner}:${prefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, prefix });
  }
  return out;
}

function tenantSpacesPrefix(prefix: string): string | null {
  const match = prefix.match(/^(tenants\/[^/]+\/)spaces\/[^/]+\//);
  return match ? `${match[1]}spaces/` : null;
}

function desktopHydratePathForSourceObject(input: {
  owner: "agent" | "space" | "user";
  sourcePrefix: string;
  key: string;
}): { path: string; sourcePrefix: string; sourcePath: string } | null {
  if (!input.key.startsWith(input.sourcePrefix)) return null;
  const relPath = input.key.slice(input.sourcePrefix.length);
  if (!shouldHydrateSourcePath(relPath)) return null;
  if (input.owner === "agent") {
    const sourcePath = stripLegacySourceRoot(relPath);
    if (!shouldHydrateSourcePath(sourcePath)) return null;
    return {
      path: `Agent/${sourcePath}`,
      sourcePrefix: input.sourcePrefix,
      sourcePath,
    };
  }
  if (input.owner === "user") {
    const sourcePath = stripLegacySourceRoot(relPath);
    if (!shouldHydrateSourcePath(sourcePath)) return null;
    return {
      path: `User/${sourcePath}`,
      sourcePrefix: input.sourcePrefix,
      sourcePath,
    };
  }
  const [spaceFolder, ...rest] = relPath.split("/");
  if (!spaceFolder || rest.length === 0) return null;
  const sourcePath = stripLegacySourceRoot(rest.join("/"));
  if (!shouldHydrateSourcePath(sourcePath)) return null;
  return {
    path: `Spaces/${spaceFolder}/${sourcePath}`,
    sourcePrefix: `${input.sourcePrefix}${spaceFolder}/`,
    sourcePath,
  };
}

function legacyRenderedUserWorkspacePrefix(
  manifest: WorkspaceHydrateManifest,
): string | null {
  const sources = normalizedHydrateSources(manifest);
  const agent = sources
    .find((source) => source.owner === "agent")
    ?.prefix.match(/^tenants\/([^/]+)\/agents\/([^/]+)\//);
  const space = sources
    .find((source) => source.owner === "space")
    ?.prefix.match(/^tenants\/([^/]+)\/spaces\/([^/]+)\//);
  const user = sources
    .find((source) => source.owner === "user")
    ?.prefix.match(/^tenants\/([^/]+)\/users\/([^/]+)\//);
  if (!agent || !space || !user) return null;
  const [, tenantSlug, agentSlug] = agent;
  const [, spaceTenantSlug, spaceSlug] = space;
  const [, userTenantSlug, userSlug] = user;
  if (tenantSlug !== spaceTenantSlug || tenantSlug !== userTenantSlug) {
    return null;
  }
  return `tenants/${tenantSlug}/rendered/${agentSlug}/${spaceSlug}/${userSlug}/`;
}

function legacyRenderedUserHydrateEntry(input: {
  object: WorkspaceRemoteObject;
  legacyPrefix: string;
  userSourcePrefix: string;
}): {
  remoteEntry: RemoteEntry;
  manifestFile: WorkspaceHydrateManifestFile & {
    owner: "user";
    sourcePrefix: string;
    sourcePath: string;
    readOnly: false;
  };
} | null {
  if (!input.object.key.startsWith(input.legacyPrefix)) return null;
  const sourcePath = input.object.key.slice(input.legacyPrefix.length);
  if (!isLegacyRenderedUserPath(sourcePath)) return null;
  const path = `User/${sourcePath}`;
  return {
    remoteEntry: {
      key: input.object.key,
      rel: path,
      signature: remoteObjectSignature(input.object),
    },
    manifestFile: {
      path,
      owner: "user",
      sourceKey: `${input.userSourcePrefix}${sourcePath}`,
      sourcePrefix: input.userSourcePrefix,
      sourcePath,
      lastModified: input.object.lastModified,
      etag: input.object.eTag,
      size: input.object.size,
      readOnly: false,
    },
  };
}

function isLegacyRenderedUserPath(sourcePath: string): boolean {
  if (sourcePath === "USER.md") return true;
  if (!sourcePath.startsWith("memory/")) return false;
  if (sourcePath.startsWith("memory/.") || sourcePath.includes("/.")) {
    return false;
  }
  if (sourcePath.startsWith("memory/reports/")) return false;
  return shouldHydrateSourcePath(sourcePath);
}

function ensureManifestFile(
  manifest: WorkspaceHydrateManifest,
  file: WorkspaceHydrateManifestFile,
): void {
  const files = (manifest.files ??= []);
  const path = stringValue(file.path);
  const sourceKey = stringValue(file.sourceKey);
  if (
    files.some(
      (existing) =>
        (path && existing.path === path) ||
        (sourceKey && existing.sourceKey === sourceKey),
    )
  ) {
    return;
  }
  files.push(file);
}

function desktopHydratePath(input: {
  owner: string | null;
  path: string | null;
  sourcePath: string | null;
  spaceFolder: string;
}): string | undefined {
  const path = input.path ?? "";
  if (
    path.startsWith("Agent/") ||
    path.startsWith("User/") ||
    path.startsWith("Spaces/")
  ) {
    return normalizeTupleHydratePath(path);
  }
  const sourcePath = stripLegacySourceRoot(input.sourcePath ?? path);
  if (!sourcePath || isWorkspaceArchivesPath(sourcePath)) return undefined;
  if (input.owner === "agent") return `Agent/${sourcePath}`;
  if (input.owner === "user") return `User/${sourcePath}`;
  if (
    input.owner === "space" ||
    input.owner === "thread_goal" ||
    input.owner === "system"
  ) {
    return `Spaces/${input.spaceFolder}/${sourcePath}`;
  }
  return path || undefined;
}

function normalizeTupleHydratePath(path: string): string | undefined {
  if (path.startsWith("Agent/")) {
    const sourcePath = stripLegacySourceRoot(path.slice("Agent/".length));
    if (!sourcePath || isWorkspaceArchivesPath(sourcePath)) return undefined;
    return `Agent/${sourcePath}`;
  }
  if (path.startsWith("User/")) {
    const sourcePath = stripLegacySourceRoot(path.slice("User/".length));
    if (!sourcePath || isWorkspaceArchivesPath(sourcePath)) return undefined;
    return `User/${sourcePath}`;
  }
  if (path.startsWith("Spaces/")) {
    const [root, folder, ...rest] = path.split("/");
    if (!root || !folder || rest.length === 0) return path;
    const sourcePath = stripLegacySourceRoot(rest.join("/"));
    if (!sourcePath || isWorkspaceArchivesPath(sourcePath)) return undefined;
    return `${root}/${folder}/${sourcePath}`;
  }
  return path || undefined;
}

function manifestObjectSignature(
  key: string,
  object: WorkspaceHydrateManifestFile | WorkspaceHydrateManifestStatusMount,
): string {
  return [
    key,
    stringValue(object.etag) ?? "",
    typeof object.size === "number" && Number.isFinite(object.size)
      ? String(object.size)
      : "",
    stringValue(object.lastModified) ?? "",
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
    if ((await readdir(dir)).length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
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
