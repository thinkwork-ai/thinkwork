import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface WorkspaceAgent {
  id: string;
  slug: string;
}

export interface WorkspaceObjectStore {
  listObjects(prefix: string): Promise<string[]>;
  objectExists(key: string): Promise<boolean>;
  objectFingerprint(key: string): Promise<string | null>;
  copyObject(sourceKey: string, targetKey: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  countObjects(prefix: string): Promise<number>;
}

export interface WorkspaceCopyPlan {
  sourceAgentId: string;
  sourceAgentSlug: string;
  sourceKey: string;
  targetKey: string;
}

export interface WorkspaceConflict {
  sourceAgentId: string;
  sourceAgentSlug: string;
  sourceKey: string;
  targetKey: string;
  reason: "target_exists";
}

export interface FoldAgentWorkspacesInput {
  store: WorkspaceObjectStore;
  tenantSlug: string;
  canonicalAgent: WorkspaceAgent;
  sourceAgents: WorkspaceAgent[];
  dryRun?: boolean;
}

export interface FoldAgentWorkspacesResult {
  canonicalPrefix: string;
  plannedCopies: WorkspaceCopyPlan[];
  copiedKeys: string[];
  conflicts: WorkspaceConflict[];
  canonicalPrefixObjectCount: number;
}

export function assertWorkspaceSlug(kind: string, slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid ${kind} slug "${slug}". Expected ${SLUG_RE.source}; aborting workspace fold.`,
    );
  }
}

export function workspacePrefix(tenantSlug: string, agentSlug: string): string {
  assertWorkspaceSlug("tenant", tenantSlug);
  assertWorkspaceSlug("agent", agentSlug);
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

export function assertTargetContained(
  targetKey: string,
  tenantSlug: string,
  canonicalAgentSlug: string,
): void {
  const prefix = workspacePrefix(tenantSlug, canonicalAgentSlug);
  if (!targetKey.startsWith(prefix)) {
    throw new Error(
      `Workspace fold target escaped canonical prefix: target=${targetKey} prefix=${prefix}`,
    );
  }
}

export async function foldAgentWorkspaces({
  store,
  tenantSlug,
  canonicalAgent,
  sourceAgents,
  dryRun = false,
}: FoldAgentWorkspacesInput): Promise<FoldAgentWorkspacesResult> {
  const canonicalPrefix = workspacePrefix(tenantSlug, canonicalAgent.slug);
  const plannedCopies: WorkspaceCopyPlan[] = [];
  const conflicts: WorkspaceConflict[] = [];

  for (const sourceAgent of sourceAgents) {
    const sourcePrefix = workspacePrefix(tenantSlug, sourceAgent.slug);
    const sourceKeys = await store.listObjects(sourcePrefix);

    for (const sourceKey of sourceKeys) {
      if (!sourceKey.startsWith(sourcePrefix) || sourceKey.endsWith("/")) {
        continue;
      }

      const relativeKey = sourceKey.slice(sourcePrefix.length);
      if (!relativeKey) continue;

      const targetKey = `${canonicalPrefix}${sourceAgent.slug}/${relativeKey}`;
      assertTargetContained(targetKey, tenantSlug, canonicalAgent.slug);

      const copyPlan = {
        sourceAgentId: sourceAgent.id,
        sourceAgentSlug: sourceAgent.slug,
        sourceKey,
        targetKey,
      };
      plannedCopies.push(copyPlan);

      if (await store.objectExists(targetKey)) {
        const [sourceFingerprint, targetFingerprint] = await Promise.all([
          store.objectFingerprint(sourceKey),
          store.objectFingerprint(targetKey),
        ]);
        if (!sourceFingerprint || sourceFingerprint !== targetFingerprint) {
          conflicts.push({
            ...copyPlan,
            reason: "target_exists",
          });
        }
      }
    }
  }

  if (conflicts.length > 0 || dryRun) {
    const existingCount = await store.countObjects(canonicalPrefix);
    return {
      canonicalPrefix,
      plannedCopies,
      copiedKeys: [],
      conflicts,
      canonicalPrefixObjectCount:
        existingCount + (dryRun ? plannedCopies.length : 0),
    };
  }

  const copiedKeys: string[] = [];
  try {
    for (const copy of plannedCopies) {
      if (await store.objectExists(copy.targetKey)) continue;
      await store.copyObject(copy.sourceKey, copy.targetKey);
      copiedKeys.push(copy.targetKey);
    }
  } catch (error) {
    if (copiedKeys.length > 0) {
      await store.deleteObjects(copiedKeys);
    }
    throw error;
  }

  return {
    canonicalPrefix,
    plannedCopies,
    copiedKeys,
    conflicts,
    canonicalPrefixObjectCount: await store.countObjects(canonicalPrefix),
  };
}

export class S3WorkspaceObjectStore implements WorkspaceObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(input: { bucket: string; client?: S3Client }) {
    if (!input.bucket) throw new Error("S3 workspace bucket is required");
    this.bucket = input.bucket;
    this.client = input.client ?? new S3Client({});
  }

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let ContinuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      ContinuationToken = response.NextContinuationToken;
    } while (ContinuationToken);

    return keys;
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async objectFingerprint(key: string): Promise<string | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return `${object.ETag ?? ""}:${object.ContentLength ?? ""}`;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `/${this.bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`,
        Key: targetKey,
      }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async countObjects(prefix: string): Promise<number> {
    return (await this.listObjects(prefix)).filter((key) => !key.endsWith("/"))
      .length;
  }
}
