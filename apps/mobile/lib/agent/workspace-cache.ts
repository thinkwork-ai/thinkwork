import type { WorkspaceFileMeta, WorkspaceTarget } from "@/lib/workspace-api";

const CACHE_KEY_PREFIX = "thinkwork:mobile-pi:workspace-cache:";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_OFFLINE_EXECUTION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PARTITIONS = 12;
const DEFAULT_SPACE_FOLDER_NAME = "default";
const TUPLE_ROOTS = new Set(["Agent", "Spaces", "User"]);

export interface WorkspaceCachePartition {
  stage: string;
  tenantId?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  userId?: string | null;
}

export interface WorkspaceCachedFile {
  path: string;
  content: string;
  source?: string;
  sha256?: string;
}

export interface WorkspaceCacheManifest {
  partition: WorkspaceCachePartition;
  syncedAt: string;
  accessValidatedAt?: string;
  total: number;
  files: Record<string, WorkspaceCachedFile>;
}

export interface WorkspaceCacheSyncInput {
  partition: WorkspaceCachePartition;
  targets: readonly WorkspaceTarget[];
}

export interface WorkspaceCacheSyncResult {
  cacheKey: string;
  synced: number;
  deleted: number;
  total: number;
  cacheHit?: boolean;
  cacheStale?: boolean;
  accessRevalidated?: boolean;
}

export interface WorkspaceCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
}

export interface WorkspaceCacheSource {
  listFiles(
    target: WorkspaceTarget,
    options: { includeContent: true },
  ): Promise<{ files: WorkspaceFileMeta[] }>;
}

export interface WorkspaceCacheOptions {
  cacheTtlMs?: number;
  offlineExecutionTtlMs?: number;
  maxPartitions?: number;
  now?: () => Date;
  backgroundRefresh?: (refresh: () => Promise<void>) => void;
  onBackgroundRefreshError?: (err: unknown) => void;
}

export interface WorkspaceRevocationInput {
  stage: string;
  tenantId?: string | null;
  spaceId: string;
  agentId?: string | null;
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

export class MemoryWorkspaceCacheStorage implements WorkspaceCacheStorage {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async getAllKeys(): Promise<readonly string[]> {
    return [...this.values.keys()];
  }
}

export class WorkspaceCache {
  constructor(
    private readonly storage: WorkspaceCacheStorage,
    private readonly source: WorkspaceCacheSource = workspaceApiCacheSource,
    private readonly options: WorkspaceCacheOptions = {},
  ) {}

  async sync(
    input: WorkspaceCacheSyncInput,
  ): Promise<WorkspaceCacheSyncResult> {
    const cacheKey = cacheKeyForPartition(input.partition);
    const now = this.options.now?.() ?? new Date();
    const cached = await this.readFreshManifest(input.partition, now);
    if (cached) {
      await this.evictOldPartitions();
      return {
        cacheKey,
        synced: 0,
        deleted: 0,
        total: cached.total,
        cacheHit: true,
      };
    }

    const stale = await this.readManifest(input.partition);
    if (
      stale &&
      Object.keys(stale.files).length > 0 &&
      !this.isOfflineExecutionExpired(stale, now)
    ) {
      this.refreshInBackground(input);
      await this.evictOldPartitions();
      return {
        cacheKey,
        synced: 0,
        deleted: 0,
        total: stale.total,
        cacheHit: true,
        cacheStale: true,
      };
    }

    try {
      return await this.refresh(input);
    } catch (err) {
      if (
        stale &&
        Object.keys(stale.files).length > 0 &&
        this.isOfflineExecutionExpired(stale, now)
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
    if (!this.storage.getAllKeys) {
      return { deleted: 0 };
    }
    const expected = {
      stage: safeSegment(input.stage),
      tenantId: safeSegment(input.tenantId ?? "tenant"),
      agentId: input.agentId?.trim() ? safeSegment(input.agentId) : null,
      spaceId: safeSegment(input.spaceId),
      userId: input.userId?.trim() ? safeSegment(input.userId) : null,
    };
    const keys = (await this.storage.getAllKeys()).filter((key) =>
      key.startsWith(CACHE_KEY_PREFIX),
    );
    let deleted = 0;
    for (const key of keys) {
      const parts = key.slice(CACHE_KEY_PREFIX.length).split(":");
      if (parts.length !== 5) continue;
      const [stage, tenantId, agentId, spaceId, userId] = parts;
      if (stage !== expected.stage) continue;
      if (tenantId !== expected.tenantId) continue;
      if (spaceId !== expected.spaceId) continue;
      if (expected.agentId && agentId !== expected.agentId) continue;
      if (expected.userId && userId !== expected.userId) continue;
      await this.storage.removeItem(key);
      deleted++;
    }
    return { deleted };
  }

  async readFile(
    partition: WorkspaceCachePartition,
    filePath: string,
  ): Promise<WorkspaceCachedFile | null> {
    const manifest = await this.readManifest(partition);
    if (!manifest) return null;
    const path = assertSafeRelativePath(filePath);
    for (const candidate of workspaceReadCandidates(path, manifest.files)) {
      const file = manifest.files[candidate];
      if (file) return file;
    }
    return null;
  }

  async listFiles(
    partition: WorkspaceCachePartition,
    dirPath = "",
  ): Promise<WorkspaceCachedFile[]> {
    const manifest = await this.readManifest(partition);
    if (!manifest) return [];
    const prefix = dirPath ? `${assertSafeRelativePath(dirPath)}/` : "";
    return Object.values(manifest.files)
      .filter((file) => file.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async refresh(
    input: WorkspaceCacheSyncInput,
  ): Promise<WorkspaceCacheSyncResult> {
    const cacheKey = cacheKeyForPartition(input.partition);
    const prior = await this.readManifest(input.partition);
    const files: Record<string, WorkspaceCachedFile> = {};

    for (const target of input.targets) {
      const listed = await this.source.listFiles(target, {
        includeContent: true,
      });
      for (const file of listed.files) {
        if (!file.content) continue;
        const path = workspaceRuntimePathForFile(target, file);
        if (!path) continue;
        files[path] = {
          path,
          content: file.content,
          source: file.source,
          sha256: file.sha256,
        };
      }
    }

    const priorKeys = new Set(Object.keys(prior?.files ?? {}));
    const nextKeys = new Set(Object.keys(files));
    let synced = 0;
    for (const key of nextKeys) {
      const before = prior?.files[key];
      const after = files[key];
      if (
        !before ||
        before.sha256 !== after.sha256 ||
        before.content !== after.content
      ) {
        synced++;
      }
    }
    let deleted = 0;
    for (const key of priorKeys) {
      if (!nextKeys.has(key)) deleted++;
    }

    const validatedAt = (this.options.now?.() ?? new Date()).toISOString();
    await this.writeManifest(input.partition, {
      partition: input.partition,
      syncedAt: validatedAt,
      accessValidatedAt: validatedAt,
      total: nextKeys.size,
      files,
    });
    await this.evictOldPartitions();

    return {
      cacheKey,
      synced,
      deleted,
      total: nextKeys.size,
      accessRevalidated: true,
    };
  }

  private refreshInBackground(input: WorkspaceCacheSyncInput): void {
    const refresh = async () => {
      await this.refresh(input);
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

  private async readFreshManifest(
    partition: WorkspaceCachePartition,
    now: Date,
  ): Promise<WorkspaceCacheManifest | null> {
    const cacheTtlMs = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (cacheTtlMs <= 0) return null;
    const manifest = await this.readManifest(partition);
    if (!manifest) return null;
    if (this.isOfflineExecutionExpired(manifest, now)) return null;
    const syncedAt = Date.parse(manifest.syncedAt);
    if (!Number.isFinite(syncedAt)) return null;
    const ageMs = now.getTime() - syncedAt;
    if (ageMs < 0 || ageMs > cacheTtlMs) return null;
    return Object.keys(manifest.files).length > 0 ? manifest : null;
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

  private async readManifest(
    partition: WorkspaceCachePartition,
  ): Promise<WorkspaceCacheManifest | null> {
    try {
      const raw = await this.storage.getItem(cacheKeyForPartition(partition));
      if (!raw) return null;
      const manifest = JSON.parse(raw) as WorkspaceCacheManifest;
      if (!manifest.files || !Number.isFinite(manifest.total)) return null;
      return normalizeStoredManifest(manifest);
    } catch {
      return null;
    }
  }

  private async writeManifest(
    partition: WorkspaceCachePartition,
    manifest: WorkspaceCacheManifest,
  ): Promise<void> {
    await this.storage.setItem(
      cacheKeyForPartition(partition),
      JSON.stringify(manifest),
    );
  }

  private async evictOldPartitions(): Promise<void> {
    const maxPartitions = this.options.maxPartitions ?? DEFAULT_MAX_PARTITIONS;
    if (maxPartitions <= 0 || !this.storage.getAllKeys) return;

    const keys = (await this.storage.getAllKeys()).filter((key) =>
      key.startsWith(CACHE_KEY_PREFIX),
    );
    const manifests = await Promise.all(
      keys.map(async (key) => ({
        key,
        manifest: await this.storage
          .getItem(key)
          .then((raw) =>
            raw ? (JSON.parse(raw) as WorkspaceCacheManifest) : null,
          )
          .catch(() => null),
      })),
    );
    manifests.sort((a, b) => {
      const at = Date.parse(a.manifest?.syncedAt ?? "");
      const bt = Date.parse(b.manifest?.syncedAt ?? "");
      return bt - at;
    });
    for (const stale of manifests.slice(maxPartitions)) {
      await this.storage.removeItem(stale.key);
    }
  }
}

export const workspaceApiCacheSource: WorkspaceCacheSource = {
  async listFiles(target, options) {
    const api = await import("@/lib/workspace-api");
    return api.listWorkspaceFiles(target, options);
  },
};

let defaultWorkspaceCache: WorkspaceCache | null = null;

export function getDefaultWorkspaceCache(): WorkspaceCache {
  defaultWorkspaceCache ??= new WorkspaceCache(createAsyncStorageAdapter());
  return defaultWorkspaceCache;
}

export function workspaceTargetsForContext(input: {
  agentId?: string | null;
  spaceId?: string | null;
  spaceFolderName?: string | null;
  userId?: string | null;
}): WorkspaceTarget[] {
  const targets: WorkspaceTarget[] = [];
  if (input.agentId?.trim()) targets.push({ agentId: input.agentId.trim() });
  if (input.spaceId?.trim()) {
    targets.push({
      spaceId: input.spaceId.trim(),
      spaceFolderName: input.spaceFolderName?.trim() || null,
    });
  }
  if (input.userId?.trim()) targets.push({ userId: input.userId.trim() });
  return targets;
}

export function createWorkspaceCachePartition(input: {
  stage?: string | null;
  tenantId?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  userId?: string | null;
}): WorkspaceCachePartition {
  return {
    stage:
      input.stage?.trim() ||
      process.env.EXPO_PUBLIC_STAGE ||
      process.env.EXPO_PUBLIC_THINKWORK_STAGE ||
      "dev",
    tenantId: input.tenantId ?? null,
    agentId: input.agentId ?? null,
    spaceId: input.spaceId ?? null,
    userId: input.userId ?? null,
  };
}

export async function prewarmWorkspaceCache(input: {
  stage?: string | null;
  tenantId?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  userId?: string | null;
  cache?: WorkspaceCache;
}): Promise<WorkspaceCacheSyncResult | null> {
  const targets = workspaceTargetsForContext(input);
  if (targets.length === 0) return null;
  const cache = input.cache ?? getDefaultWorkspaceCache();
  return cache.sync({
    partition: createWorkspaceCachePartition(input),
    targets,
  });
}

export function cacheKeyForPartition(
  partition: WorkspaceCachePartition,
): string {
  return `${CACHE_KEY_PREFIX}${[
    safeSegment(partition.stage),
    safeSegment(partition.tenantId ?? "tenant"),
    safeSegment(partition.agentId ?? "agent"),
    safeSegment(partition.spaceId ?? "default"),
    safeSegment(partition.userId ?? "user"),
  ].join(":")}`;
}

export function assertSafeRelativePath(input: string): string {
  const path = input.trim().replace(/^\.\/+/, "");
  if (!path) {
    throw new WorkspaceBoundaryError("workspace path is required");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new WorkspaceBoundaryError("workspace path must be relative");
  }
  if (path.split("/").some((part) => part === "." || part === ".." || !part)) {
    throw new WorkspaceBoundaryError("workspace path is unsafe");
  }
  return path;
}

export function workspaceRuntimePathForFile(
  target: WorkspaceTarget,
  file: Pick<WorkspaceFileMeta, "path" | "source">,
): string | null {
  const safePath = assertSafeRelativePath(file.path);
  if (isWorkspaceArchivesPath(safePath)) return null;
  if (hasTupleRoot(safePath)) return normalizeTupleRuntimePath(safePath);

  const relativePath = stripLegacySourceRoot(safePath);
  if (isWorkspaceArchivesPath(relativePath)) return null;
  const source = file.source;
  if (
    source === "user" ||
    (!source && "userId" in target) ||
    ("userId" in target && source !== "agent" && source !== "space")
  ) {
    return `User/${relativePath}`;
  }
  if (source === "space" || "spaceId" in target) {
    return `Spaces/${spaceFolderNameForTarget(target)}/${relativePath}`;
  }
  return `Agent/${relativePath}`;
}

function normalizeStoredManifest(
  manifest: WorkspaceCacheManifest,
): WorkspaceCacheManifest {
  const files: Record<string, WorkspaceCachedFile> = {};
  for (const file of Object.values(manifest.files)) {
    const path = normalizeStoredRuntimePath(file);
    if (!path) continue;
    files[path] = { ...file, path };
  }
  return {
    ...manifest,
    total: Object.keys(files).length,
    files,
  };
}

function normalizeStoredRuntimePath(
  file: WorkspaceCachedFile,
): string | null {
  const safePath = assertSafeRelativePath(file.path);
  if (isWorkspaceArchivesPath(safePath)) return null;

  const tuplePath = normalizeTupleRuntimePath(safePath);
  if (!tuplePath) return null;
  if (tuplePath !== safePath || hasTupleRoot(tuplePath)) return tuplePath;

  const relativePath = stripLegacySourceRoot(safePath);
  if (isWorkspaceArchivesPath(relativePath)) return null;
  if (file.source === "user") return `User/${relativePath}`;
  if (file.source === "space") {
    return `Spaces/${DEFAULT_SPACE_FOLDER_NAME}/${relativePath}`;
  }
  return `Agent/${relativePath}`;
}

function normalizeTupleRuntimePath(path: string): string | null {
  if (path.startsWith("Agent/")) {
    const relativePath = stripLegacySourceRoot(path.slice("Agent/".length));
    if (!relativePath || isWorkspaceArchivesPath(relativePath)) return null;
    return `Agent/${relativePath}`;
  }
  if (path.startsWith("Spaces/")) {
    const [, folder, ...rest] = path.split("/");
    if (!folder || rest.length === 0) return path;
    const relativePath = stripLegacySourceRoot(rest.join("/"));
    if (!relativePath || isWorkspaceArchivesPath(relativePath)) return null;
    return `Spaces/${folder}/${relativePath}`;
  }
  return path;
}

function workspaceReadCandidates(
  path: string,
  files: Record<string, WorkspaceCachedFile>,
): string[] {
  if (hasTupleRoot(path)) return [path];

  const candidates = [path];
  if (path === "AGENTS.md") candidates.unshift("Agent/AGENTS.md");
  if (path === "USER.md") candidates.unshift("User/USER.md");
  if (path === "SPACE.md") {
    candidates.unshift("Spaces/default/SPACE.md");
    for (const key of Object.keys(files)) {
      if (/^Spaces\/[^/]+\/SPACE\.md$/.test(key)) {
        candidates.unshift(key);
      }
    }
  }

  candidates.push(`Agent/${path}`, `User/${path}`);
  for (const key of Object.keys(files)) {
    if (key.endsWith(`/${path}`) && key.startsWith("Spaces/")) {
      candidates.push(key);
    }
  }

  return [...new Set(candidates)];
}

function hasTupleRoot(path: string): boolean {
  return TUPLE_ROOTS.has(path.split("/")[0] ?? "");
}

function stripLegacySourceRoot(path: string): string {
  let current = path;
  while (current.startsWith("source/") || current.startsWith("workspace/")) {
    current = current.replace(/^(source|workspace)\//, "");
  }
  return current;
}

function isWorkspaceArchivesPath(path: string): boolean {
  return path === "workspace-archives" || path.startsWith("workspace-archives/");
}

function spaceFolderNameForTarget(target: WorkspaceTarget): string {
  if ("spaceId" in target && target.spaceFolderName?.trim()) {
    return safeSegment(target.spaceFolderName);
  }
  return DEFAULT_SPACE_FOLDER_NAME;
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new WorkspaceBoundaryError("workspace cache partition is invalid");
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createAsyncStorageAdapter(): WorkspaceCacheStorage {
  return {
    async getItem(key) {
      const storage = await import("@react-native-async-storage/async-storage");
      return storage.default.getItem(key);
    },
    async setItem(key, value) {
      const storage = await import("@react-native-async-storage/async-storage");
      await storage.default.setItem(key, value);
    },
    async removeItem(key) {
      const storage = await import("@react-native-async-storage/async-storage");
      await storage.default.removeItem(key);
    },
    async getAllKeys() {
      const storage = await import("@react-native-async-storage/async-storage");
      return storage.default.getAllKeys();
    },
  };
}
