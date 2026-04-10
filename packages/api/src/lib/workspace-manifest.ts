/**
 * Shared workspace manifest regeneration.
 *
 * Rebuilds manifest.json for an agent's workspace so the runtime's
 * per-turn ETag check detects file changes and re-syncs.
 *
 * Imported by:
 *   - workspace-files.ts (after put/delete)
 *   - workspace-map-generator.ts (after AGENTS.md/CONTEXT.md regen)
 */

import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function workspacePrefix(tenantSlug: string, instanceId: string): string {
  return `tenants/${tenantSlug}/agents/${instanceId}/workspace/`;
}

export async function regenerateManifest(
  bucket: string,
  tenantSlug: string,
  instanceId: string,
): Promise<void> {
  const prefix = workspacePrefix(tenantSlug, instanceId);
  const files: { path: string; etag: string; size: number; last_modified: string }[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of result.Contents ?? []) {
      if (!obj.Key) continue;
      const relPath = obj.Key.slice(prefix.length);
      if (!relPath || relPath === "manifest.json") continue;
      files.push({
        path: relPath,
        etag: obj.ETag ?? "",
        size: obj.Size ?? 0,
        last_modified: obj.LastModified?.toISOString() ?? "",
      });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  const manifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    files,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}manifest.json`,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
    }),
  );
}
