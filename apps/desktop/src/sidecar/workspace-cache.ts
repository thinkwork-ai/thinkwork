import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const SKIP_FILES = new Set(["manifest.json", "_defaults_version"]);
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
  ) {}

  async sync(input: WorkspaceSyncInput): Promise<WorkspaceSyncResult> {
    const prefix = normalizeRenderedWorkspacePrefix(
      input.partition.tenantSlug,
      input.partition.agentSlug,
      input.renderedPrefix,
    );
    const localDir = this.partitionPath(input.partition);
    await mkdir(localDir, { recursive: true });

    const remote = (
      await this.store.listObjects({
        bucket: input.bucket,
        prefix,
      })
    )
      .map((obj) => obj.key)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((rel) => rel && !SKIP_FILES.has(rel));
    const remoteSet = new Set(remote);

    let synced = 0;
    for (const rel of remote) {
      assertSafeRelativePath(rel);
      const localPath = path.join(localDir, rel);
      await mkdir(path.dirname(localPath), { recursive: true });
      const bytes = await this.store.getObjectBytes({
        bucket: input.bucket,
        key: `${prefix}${rel}`,
      });
      await writeFile(localPath, bytes);
      synced++;
    }

    let deleted = 0;
    for (const rel of await listLocalFiles(localDir)) {
      if (remoteSet.has(rel)) continue;
      await rm(path.join(localDir, rel), { force: true });
      deleted++;
    }
    await pruneEmptyDirs(localDir, localDir);
    await this.evictOldPartitions(input.partition.stage);

    return { localDir, prefix, synced, deleted, total: remote.length };
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
  const allowedPrefix = `tenants/${tenantSlug}/rendered/${agentSlug}/`;
  if (!normalized.startsWith(allowedPrefix)) {
    throw new WorkspaceBoundaryError(
      "rendered_workspace_prefix is outside the expected tenant/agent scope",
    );
  }
  return normalized;
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
          if (obj.Key) out.push({ key: obj.Key });
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
