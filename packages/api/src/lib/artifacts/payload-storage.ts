import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

let s3: S3Client | null = null;

export interface ArtifactPayloadStorageInput {
  bucket?: string;
  key: string;
  tenantId: string;
  s3?: S3Client;
}

export interface ArtifactPayloadKeyInput {
  tenantId: string;
  artifactId: string;
  revision?: string;
}

export interface MessageArtifactPayloadKeyInput {
  tenantId: string;
  messageArtifactId: string;
  revision?: string;
}

export interface AppletStatePayloadKeyInput {
  tenantId: string;
  appId: string;
  instanceId: string;
  stateKey: string;
  revision?: string;
}

export function artifactPayloadsBucket(): string {
  const bucket =
    process.env.ARTIFACT_PAYLOADS_BUCKET || process.env.WORKSPACE_BUCKET || "";
  if (!bucket) {
    throw new Error("ARTIFACT_PAYLOADS_BUCKET or WORKSPACE_BUCKET is required");
  }
  return bucket;
}

export function artifactContentKey({
  tenantId,
  artifactId,
  revision,
}: ArtifactPayloadKeyInput): string {
  if (revision) {
    return `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content/${revision}.md`;
  }
  return `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content.md`;
}

export function messageArtifactContentKey({
  tenantId,
  messageArtifactId,
  revision,
}: MessageArtifactPayloadKeyInput): string {
  if (revision) {
    return `tenants/${tenantId}/artifact-payloads/message-artifacts/${messageArtifactId}/content/${revision}`;
  }
  return `tenants/${tenantId}/artifact-payloads/message-artifacts/${messageArtifactId}/content`;
}

export function appletStatePayloadKey({
  tenantId,
  appId,
  instanceId,
  stateKey,
  revision,
}: AppletStatePayloadKeyInput): string {
  const baseKey = `tenants/${tenantId}/applets/${appId}/state/${hashPathPart(
    instanceId,
  )}/${hashPathPart(stateKey)}`;
  return revision ? `${baseKey}/${revision}.json` : `${baseKey}.json`;
}

export function assertArtifactPayloadS3Key(
  tenantId: string,
  key: string,
): string {
  const artifactPrefix = `tenants/${tenantId}/artifact-payloads/`;
  const appletStatePrefix = `tenants/${tenantId}/applets/`;
  const validSuffix =
    /^tenants\/[^/]+\/artifact-payloads\/artifacts\/[^/]+\/content\.md$/.test(
      key,
    ) ||
    /^tenants\/[^/]+\/artifact-payloads\/artifacts\/[^/]+\/content\/[^/]+\.md$/.test(
      key,
    ) ||
    /^tenants\/[^/]+\/artifact-payloads\/message-artifacts\/[^/]+\/content$/.test(
      key,
    ) ||
    /^tenants\/[^/]+\/artifact-payloads\/message-artifacts\/[^/]+\/content\/[^/]+$/.test(
      key,
    ) ||
    /^tenants\/[^/]+\/applets\/[^/]+\/state\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(
      key,
    ) ||
    /^tenants\/[^/]+\/applets\/[^/]+\/state\/[a-f0-9]{64}\/[a-f0-9]{64}\/[^/]+\.json$/.test(
      key,
    );

  if (
    (!key.startsWith(artifactPrefix) && !key.startsWith(appletStatePrefix)) ||
    !validSuffix ||
    key.includes("..") ||
    key.includes("//")
  ) {
    throw new Error("Artifact payload S3 key is outside the tenant prefix");
  }
  return key;
}

export function isArtifactPayloadS3Key(tenantId: string, key: string): boolean {
  try {
    assertArtifactPayloadS3Key(tenantId, key);
    return true;
  } catch {
    return false;
  }
}

export async function writeArtifactPayloadToS3({
  bucket,
  key,
  tenantId,
  body,
  contentType,
  s3: client,
}: ArtifactPayloadStorageInput & {
  body: string;
  contentType: string;
}): Promise<void> {
  const safeKey = assertArtifactPayloadS3Key(tenantId, key);
  await getS3(client).send(
    new PutObjectCommand({
      Bucket: bucket ?? artifactPayloadsBucket(),
      Key: safeKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function readArtifactPayloadFromS3({
  bucket,
  key,
  tenantId,
  s3: client,
}: ArtifactPayloadStorageInput): Promise<string> {
  const safeKey = assertArtifactPayloadS3Key(tenantId, key);
  const response = await getS3(client).send(
    new GetObjectCommand({
      Bucket: bucket ?? artifactPayloadsBucket(),
      Key: safeKey,
    }),
  );
  const body = await response.Body?.transformToString();
  if (body === undefined) throw new Error("Artifact payload S3 object is missing");
  return body;
}

export async function writeArtifactJsonPayloadToS3({
  value,
  ...input
}: ArtifactPayloadStorageInput & { value: unknown }): Promise<void> {
  await writeArtifactPayloadToS3({
    ...input,
    body: JSON.stringify(value),
    contentType: "application/json",
  });
}

export async function readArtifactJsonPayloadFromS3({
  ...input
}: ArtifactPayloadStorageInput): Promise<unknown> {
  return JSON.parse(await readArtifactPayloadFromS3(input));
}

function hashPathPart(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getS3(client?: S3Client): S3Client {
  if (client) return client;
  if (!s3) s3 = new S3Client({});
  return s3;
}
