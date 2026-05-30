import type { WorkspaceFileMeta, WorkspaceTarget } from "@/lib/workspace-api";

const CACHE_KEY_PREFIX = "thinkwork:mobile-pi:workspace-cache:";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PARTITIONS = 12;

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
  maxPartitions?: number;
  now?: () => Date;
  backgroundRefresh?: (refresh: () => Promise<void>) => void;
  onBackgroundRefreshError?: (err: unknown) => void;
}

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
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
    const cached = await this.readFreshManifest(input.partition);
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
    if (stale && Object.keys(stale.files).length > 0) {
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

    return this.refresh(input);
  }

  async readFile(
    partition: WorkspaceCachePartition,
    filePath: string,
  ): Promise<WorkspaceCachedFile | null> {
    const manifest = await this.readManifest(partition);
    if (!manifest) return null;
    const path = assertSafeRelativePath(filePath);
    return manifest.files[path] ?? null;
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
        const path = assertSafeRelativePath(file.path);
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

    await this.writeManifest(input.partition, {
      partition: input.partition,
      syncedAt: (this.options.now?.() ?? new Date()).toISOString(),
      total: nextKeys.size,
      files,
    });
    await this.evictOldPartitions();

    return {
      cacheKey,
      synced,
      deleted,
      total: nextKeys.size,
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
  ): Promise<WorkspaceCacheManifest | null> {
    const cacheTtlMs = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (cacheTtlMs <= 0) return null;
    const manifest = await this.readManifest(partition);
    if (!manifest) return null;
    const syncedAt = Date.parse(manifest.syncedAt);
    if (!Number.isFinite(syncedAt)) return null;
    const ageMs = (this.options.now?.() ?? new Date()).getTime() - syncedAt;
    if (ageMs < 0 || ageMs > cacheTtlMs) return null;
    return Object.keys(manifest.files).length > 0 ? manifest : null;
  }

  private async readManifest(
    partition: WorkspaceCachePartition,
  ): Promise<WorkspaceCacheManifest | null> {
    try {
      const raw = await this.storage.getItem(cacheKeyForPartition(partition));
      if (!raw) return null;
      const manifest = JSON.parse(raw) as WorkspaceCacheManifest;
      if (!manifest.files || !Number.isFinite(manifest.total)) return null;
      return manifest;
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
  userId?: string | null;
}): WorkspaceTarget[] {
  const targets: WorkspaceTarget[] = [];
  if (input.agentId?.trim()) targets.push({ agentId: input.agentId.trim() });
  if (input.spaceId?.trim()) targets.push({ spaceId: input.spaceId.trim() });
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
