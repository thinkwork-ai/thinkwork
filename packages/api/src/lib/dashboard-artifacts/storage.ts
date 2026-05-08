import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  parseDashboardManifestV1,
  type DashboardManifestV1,
} from "./manifest.js";

let s3: S3Client | null = null;

export interface DashboardManifestKeyInput {
  tenantId: string;
  artifactId: string;
  version?: number;
}

export interface DashboardManifestStorageInput {
  bucket?: string;
  key: string;
  tenantId: string;
  s3?: S3Client;
}

export function dashboardArtifactsBucket(): string {
  const bucket =
    process.env.DASHBOARD_ARTIFACTS_BUCKET || process.env.WORKSPACE_BUCKET || "";
  if (!bucket) {
    throw new Error("DASHBOARD_ARTIFACTS_BUCKET or WORKSPACE_BUCKET is required");
  }
  return bucket;
}

export function dashboardManifestKey({
  tenantId,
  artifactId,
  version,
}: DashboardManifestKeyInput): string {
  const suffix = version ? `manifest-v${version}.json` : "manifest.json";
  return `tenants/${tenantId}/dashboard-artifacts/${artifactId}/${suffix}`;
}

export function assertDashboardManifestKey(
  tenantId: string,
  key: string,
): string {
  const prefix = `tenants/${tenantId}/dashboard-artifacts/`;
  if (
    !key.startsWith(prefix) ||
    !key.endsWith(".json") ||
    key.includes("..") ||
    key.includes("//") ||
    key.length <= prefix.length
  ) {
    throw new Error("Dashboard manifest S3 key is outside the tenant artifact prefix");
  }
  return key;
}

export async function readDashboardManifestFromS3({
  bucket,
  key,
  tenantId,
  s3: client,
}: DashboardManifestStorageInput): Promise<DashboardManifestV1> {
  const safeKey = assertDashboardManifestKey(tenantId, key);
  const response = await getS3(client).send(
    new GetObjectCommand({
      Bucket: bucket ?? dashboardArtifactsBucket(),
      Key: safeKey,
    }),
  );
  const body = await response.Body?.transformToString();
  if (!body) throw new Error("Dashboard manifest S3 object is empty");
  return parseDashboardManifestV1(JSON.parse(body));
}

export async function writeDashboardManifestToS3({
  bucket,
  key,
  tenantId,
  manifest,
  s3: client,
}: DashboardManifestStorageInput & {
  manifest: DashboardManifestV1;
}): Promise<void> {
  const safeKey = assertDashboardManifestKey(tenantId, key);
  const validated = parseDashboardManifestV1(manifest);
  await getS3(client).send(
    new PutObjectCommand({
      Bucket: bucket ?? dashboardArtifactsBucket(),
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
