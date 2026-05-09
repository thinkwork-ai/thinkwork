import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  parseAppletMetadataV1,
  type AppletMetadataV1,
} from "./metadata.js";

let s3: S3Client | null = null;

export interface AppletStorageKeyInput {
  tenantId: string;
  appId: string;
}

export interface AppletStorageInput {
  bucket?: string;
  key: string;
  tenantId: string;
  s3?: S3Client;
}

export function appletsBucket(): string {
  const bucket =
    process.env.APPLETS_BUCKET ||
    process.env.DASHBOARD_ARTIFACTS_BUCKET ||
    process.env.WORKSPACE_BUCKET ||
    "";
  if (!bucket) {
    throw new Error(
      "APPLETS_BUCKET, DASHBOARD_ARTIFACTS_BUCKET, or WORKSPACE_BUCKET is required",
    );
  }
  return bucket;
}

export function appletSourceKey({ tenantId, appId }: AppletStorageKeyInput) {
  return `tenants/${tenantId}/applets/${appId}/source.tsx`;
}

export function appletMetadataKey({ tenantId, appId }: AppletStorageKeyInput) {
  return `tenants/${tenantId}/applets/${appId}/metadata.json`;
}

export function appletBundleCacheKey({
  tenantId,
  appId,
  cacheKey,
}: AppletStorageKeyInput & { cacheKey: string }) {
  return `tenants/${tenantId}/applets/${appId}/bundle-cache/${cacheKey}.js`;
}

export function assertAppletS3Key(tenantId: string, key: string): string {
  const prefix = `tenants/${tenantId}/applets/`;
  const validSuffix =
    key.endsWith("/source.tsx") ||
    key.endsWith("/metadata.json") ||
    /^tenants\/[^/]+\/applets\/[^/]+\/bundle-cache\/[A-Za-z0-9._-]+\.js$/.test(
      key,
    );
  if (
    !key.startsWith(prefix) ||
    !validSuffix ||
    key.includes("..") ||
    key.includes("//") ||
    key.length <= prefix.length
  ) {
    throw new Error("Applet S3 key is outside the tenant applet prefix");
  }
  return key;
}

export async function readAppletSourceFromS3({
  bucket,
  key,
  tenantId,
  s3: client,
}: AppletStorageInput): Promise<string> {
  const safeKey = assertAppletS3Key(tenantId, key);
  const response = await getS3(client).send(
    new GetObjectCommand({
      Bucket: bucket ?? appletsBucket(),
      Key: safeKey,
    }),
  );
  const body = await response.Body?.transformToString();
  if (!body) throw new Error("Applet source S3 object is empty");
  return body;
}

export async function writeAppletSourceToS3({
  bucket,
  key,
  tenantId,
  source,
  s3: client,
}: AppletStorageInput & { source: string }): Promise<void> {
  const safeKey = assertAppletS3Key(tenantId, key);
  await getS3(client).send(
    new PutObjectCommand({
      Bucket: bucket ?? appletsBucket(),
      Key: safeKey,
      Body: source,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

export async function readAppletMetadataFromS3({
  bucket,
  key,
  tenantId,
  s3: client,
}: AppletStorageInput): Promise<AppletMetadataV1> {
  const safeKey = assertAppletS3Key(tenantId, key);
  const response = await getS3(client).send(
    new GetObjectCommand({
      Bucket: bucket ?? appletsBucket(),
      Key: safeKey,
    }),
  );
  const body = await response.Body?.transformToString();
  if (!body) throw new Error("Applet metadata S3 object is empty");
  return parseAppletMetadataV1(JSON.parse(body));
}

export async function writeAppletMetadataToS3({
  bucket,
  key,
  tenantId,
  metadata,
  s3: client,
}: AppletStorageInput & { metadata: AppletMetadataV1 }): Promise<void> {
  const safeKey = assertAppletS3Key(tenantId, key);
  const validated = parseAppletMetadataV1(metadata);
  await getS3(client).send(
    new PutObjectCommand({
      Bucket: bucket ?? appletsBucket(),
      Key: safeKey,
      Body: JSON.stringify(validated),
      ContentType: "application/json",
    }),
  );
}

function getS3(client?: S3Client): S3Client {
  if (client) return client;
  if (!s3) s3 = new S3Client({});
  return s3;
}
