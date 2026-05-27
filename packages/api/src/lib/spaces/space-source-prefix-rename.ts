import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import { spaceSourcePrefix } from "./template-migration.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export interface SpaceSourcePrefixInput {
  tenantSlug: string;
  oldSpaceSlug: string;
  newSpaceSlug: string;
  bucket?: string;
  mode?: "empty-destination" | "overwrite";
  s3Client?: Pick<S3Client, "send">;
}

export interface CopySpaceSourcePrefixResult {
  copied: number;
  copiedKeys: string[];
  total: number;
  oldPrefix: string;
  newPrefix: string;
}

export interface DeleteSpaceSourcePrefixResult {
  deleted: number;
  failures: string[];
  oldPrefix: string;
}

function bucket(input?: string): string {
  return input || process.env.WORKSPACE_BUCKET || "";
}

async function listKeys(
  client: Pick<S3Client, "send">,
  bkt: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bkt,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}

export async function copySpaceSourcePrefix(
  input: SpaceSourcePrefixInput,
): Promise<CopySpaceSourcePrefixResult> {
  const oldPrefix = spaceSourcePrefix(input.tenantSlug, input.oldSpaceSlug);
  const newPrefix = spaceSourcePrefix(input.tenantSlug, input.newSpaceSlug);

  if (oldPrefix === newPrefix) {
    return { copied: 0, copiedKeys: [], total: 0, oldPrefix, newPrefix };
  }

  const bkt = bucket(input.bucket);
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

  const client = input.s3Client ?? s3;
  const mode = input.mode ?? "empty-destination";
  const sourceKeys = await listKeys(client, bkt, oldPrefix);
  if (mode === "empty-destination") {
    const destinationKeys = await listKeys(client, bkt, newPrefix);
    if (destinationKeys.length > 0) {
      throw new Error("Target Space source prefix already contains objects");
    }
  }
  if (sourceKeys.length === 0) {
    return { copied: 0, copiedKeys: [], total: 0, oldPrefix, newPrefix };
  }

  let copied = 0;
  const copiedKeys: string[] = [];
  for (const sourceKey of sourceKeys) {
    const relativePath = sourceKey.slice(oldPrefix.length);
    if (!relativePath) continue;
    const destinationKey = `${newPrefix}${relativePath}`;
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: bkt,
          CopySource: `${bkt}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
      copied++;
      copiedKeys.push(destinationKey);
    } catch (err) {
      await deleteObjectKeys({
        client,
        bucket: bkt,
        keys: copiedKeys,
      });
      throw err;
    }
  }

  return { copied, copiedKeys, total: sourceKeys.length, oldPrefix, newPrefix };
}

export async function deleteSpaceSourcePrefix(
  input: Omit<SpaceSourcePrefixInput, "newSpaceSlug">,
): Promise<DeleteSpaceSourcePrefixResult> {
  const oldPrefix = spaceSourcePrefix(input.tenantSlug, input.oldSpaceSlug);
  const bkt = bucket(input.bucket);
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

  const client = input.s3Client ?? s3;
  const keys = await listKeys(client, bkt, oldPrefix);
  if (keys.length === 0) {
    return { deleted: 0, failures: [], oldPrefix };
  }

  const result = await deleteObjectKeys({ client, bucket: bkt, keys });
  return { ...result, oldPrefix };
}

export async function deleteSpaceSourceKeys(input: {
  keys: string[];
  bucket?: string;
  s3Client?: Pick<S3Client, "send">;
}): Promise<{ deleted: number; failures: string[] }> {
  const bkt = bucket(input.bucket);
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

  return deleteObjectKeys({
    client: input.s3Client ?? s3,
    bucket: bkt,
    keys: input.keys,
  });
}

async function deleteObjectKeys(input: {
  client: Pick<S3Client, "send">;
  bucket: string;
  keys: string[];
}): Promise<{ deleted: number; failures: string[] }> {
  if (input.keys.length === 0) return { deleted: 0, failures: [] };

  let deleted = 0;
  const failures: string[] = [];
  for (let offset = 0; offset < input.keys.length; offset += 1000) {
    const batch = input.keys.slice(offset, offset + 1000);
    const response = await input.client.send(
      new DeleteObjectsCommand({
        Bucket: input.bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += batch.length - (response.Errors?.length ?? 0);
    for (const error of response.Errors ?? []) {
      failures.push(error.Key ?? "<unknown>");
    }
  }

  return { deleted, failures };
}
