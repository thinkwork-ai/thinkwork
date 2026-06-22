import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { brainArtifactManifests } from "@thinkwork/database-pg/schema";
import { createHash } from "node:crypto";
import type { Database } from "../db.js";
import { sourceHashFor } from "../knowledge-graph/artifacts.js";
import {
  assertValidOkfBundleManifest,
  assertValidOkfCurrentManifest,
  type OkfCurrentManifest,
} from "./bundle-contract.js";
import type { OkfBundleBuild, OkfBundleFile } from "./materializer.js";

type OkfPublisherS3Client = Pick<S3Client, "send">;

export interface PublishOkfBundleArgs {
  db?: Database;
  s3?: OkfPublisherS3Client;
  bucket?: string | null;
  bundle: OkfBundleBuild;
  recordArtifactManifests?: boolean;
}

export interface PublishOkfBundleResult {
  enabled: boolean;
  bundleKeyPrefix?: string;
  currentKey?: string;
  objectsWritten: number;
  bytesUploaded: number;
}

interface PutResult {
  key: string;
  uri: string;
  versionId: string | null;
  checksumSha256: string;
  byteLength: number;
  contentType: string;
}

const REGION = process.env.AWS_REGION || "us-east-1";

export async function publishOkfBundle(
  args: PublishOkfBundleArgs,
): Promise<PublishOkfBundleResult> {
  const bucket = args.bucket ?? process.env.BRAIN_ARTIFACTS_BUCKET ?? null;
  if (!bucket) {
    return {
      enabled: false,
      objectsWritten: 0,
      bytesUploaded: 0,
    };
  }

  assertValidOkfBundleManifest(args.bundle.manifest);
  assertValidOkfCurrentManifest(args.bundle.currentManifest);
  validateBundleFiles(args.bundle);

  const s3 = args.s3 ?? new S3Client({ region: REGION });
  const bundleKeyPrefix = okfBundleKeyPrefix(args.bundle);
  const currentKey = okfCurrentManifestKey(args.bundle.currentManifest);
  const written: PutResult[] = [];

  for (const file of args.bundle.files) {
    const result = await putObject({
      s3,
      bucket,
      key: `${bundleKeyPrefix}/${file.path}`,
      body: file.body,
      contentType: file.contentType,
    });
    written.push(result);
  }

  const currentBody = Buffer.from(
    JSON.stringify(args.bundle.currentManifest, null, 2),
    "utf8",
  );
  const current = await putObject({
    s3,
    bucket,
    key: currentKey,
    body: currentBody,
    contentType: "application/json; charset=utf-8",
  });
  written.push(current);

  if (args.recordArtifactManifests !== false && args.db) {
    await recordOkfArtifactManifests({
      db: args.db,
      bucket,
      bundle: args.bundle,
      bundleManifestPut: manifestPut(written, bundleKeyPrefix),
      currentManifestPut: current,
    });
  }

  return {
    enabled: true,
    bundleKeyPrefix,
    currentKey,
    objectsWritten: written.length,
    bytesUploaded: written.reduce((sum, item) => sum + item.byteLength, 0),
  };
}

export function okfBundleKeyPrefix(bundle: OkfBundleBuild): string {
  return [
    "okf-bundles",
    sanitizeSegment(bundle.tenantSlug),
    sanitizeSegment(bundle.bundleId),
  ].join("/");
}

export function okfCurrentManifestKey(
  currentManifest: OkfCurrentManifest,
): string {
  return [
    "okf-current-manifests",
    sanitizeSegment(currentManifest.tenantSlug),
    "current.json",
  ].join("/");
}

function validateBundleFiles(bundle: OkfBundleBuild): void {
  const files = new Map(bundle.files.map((file) => [file.path, file]));
  if (!files.has(".thinkwork/manifest.json")) {
    throw new Error("OKF bundle must include .thinkwork/manifest.json");
  }
  for (const object of bundle.manifest.objects) {
    if (!files.has(object.path)) {
      throw new Error(`OKF bundle object ${object.path} has no file body`);
    }
  }
}

async function putObject(args: {
  s3: OkfPublisherS3Client;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<PutResult> {
  const checksumSha256 = sha256Hex(args.body);
  const output = await args.s3.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      Metadata: {
        checksum_sha256: checksumSha256,
        artifact_kind: args.key.includes("okf-current-manifests")
          ? "okf_current_manifest"
          : "okf_bundle",
      },
    }),
  );
  return {
    key: args.key,
    uri: `s3://${args.bucket}/${args.key}`,
    versionId:
      "VersionId" in output && typeof output.VersionId === "string"
        ? output.VersionId
        : null,
    checksumSha256,
    byteLength: args.body.byteLength,
    contentType: args.contentType,
  };
}

function manifestPut(written: PutResult[], bundleKeyPrefix: string): PutResult {
  const manifest = written.find(
    (item) => item.key === `${bundleKeyPrefix}/.thinkwork/manifest.json`,
  );
  if (!manifest) throw new Error("OKF bundle manifest upload missing");
  return manifest;
}

async function recordOkfArtifactManifests(args: {
  db: Database;
  bucket: string;
  bundle: OkfBundleBuild;
  bundleManifestPut: PutResult;
  currentManifestPut: PutResult;
}): Promise<void> {
  const sourceIds = args.bundle.sourcePageIds;
  const sourceIdHash = sourceHashFor(args.bundle.bundleId, sourceIds);
  await upsertRecord({
    db: args.db,
    tenantId: args.bundle.tenantId,
    manifestKind: "okf_bundle",
    manifestUri: args.bundleManifestPut.uri,
    artifactRootUri: `s3://${args.bucket}/okf-bundles/${sanitizeSegment(args.bundle.tenantSlug)}/`,
    objectVersionId: args.bundleManifestPut.versionId,
    contentType: args.bundleManifestPut.contentType,
    byteLength: args.bundleManifestPut.byteLength,
    checksumSha256: args.bundleManifestPut.checksumSha256,
    objectCount: args.bundle.files.length,
    sourceIds,
    sourceIdHash,
    sourceCount: sourceIds.length,
    ontologyVersion: args.bundle.manifest.ontologyVersion,
    metadata: {
      recordKind: "okf_bundle",
      bundleId: args.bundle.bundleId,
      bundleChecksumSha256: args.bundle.manifest.checksumSha256,
      bundleByteCount: args.bundle.manifest.byteCount,
      bundleObjectCount: args.bundle.manifest.objectCount,
      generatedAt: args.bundle.manifest.generatedAt,
      sourceCounts: args.bundle.manifest.sourceCounts,
      freshness: args.bundle.manifest.freshness,
      redactionPosture: args.bundle.manifest.redaction.posture,
    },
  });
  await upsertRecord({
    db: args.db,
    tenantId: args.bundle.tenantId,
    manifestKind: "okf_current_manifest",
    manifestUri: args.currentManifestPut.uri,
    artifactRootUri: `s3://${args.bucket}/okf-current-manifests/${sanitizeSegment(args.bundle.tenantSlug)}/`,
    objectVersionId: args.currentManifestPut.versionId,
    contentType: args.currentManifestPut.contentType,
    byteLength: args.currentManifestPut.byteLength,
    checksumSha256: args.currentManifestPut.checksumSha256,
    objectCount: 1,
    sourceIds,
    sourceIdHash,
    sourceCount: sourceIds.length,
    ontologyVersion: args.bundle.currentManifest.bundle.ontologyVersion,
    metadata: {
      recordKind: "okf_current_manifest",
      currentBundleId: args.bundle.currentManifest.currentBundleId,
      publishedAt: args.bundle.currentManifest.publishedAt,
      sourceCounts: args.bundle.currentManifest.bundle.sourceCounts,
      freshness: args.bundle.currentManifest.bundle.freshness,
      redactionPosture: args.bundle.currentManifest.bundle.redactionPosture,
    },
  });
}

async function upsertRecord(args: {
  db: Database;
  tenantId: string;
  manifestKind: "okf_bundle" | "okf_current_manifest";
  manifestUri: string;
  artifactRootUri: string;
  objectVersionId: string | null;
  contentType: string;
  byteLength: number;
  checksumSha256: string;
  objectCount: number;
  sourceIds: string[];
  sourceIdHash: string;
  sourceCount: number;
  ontologyVersion: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  const values = {
    tenant_id: args.tenantId,
    ingest_run_id: null,
    manifest_kind: args.manifestKind,
    source_family: "okf",
    source_kind: "okf",
    source_type: "okf_wiki_navigator",
    source_ids: args.sourceIds,
    source_id_hash: args.sourceIdHash,
    manifest_uri: args.manifestUri,
    artifact_root_uri: args.artifactRootUri,
    vault_projection_root_uri: null,
    object_version_id: args.objectVersionId,
    content_type: args.contentType,
    content_encoding: null,
    byte_length: args.byteLength,
    checksum_sha256: args.checksumSha256,
    object_count: args.objectCount,
    source_count: args.sourceCount,
    embedding_model: null,
    vector_dimension: null,
    ontology_version: args.ontologyVersion,
    ontology_mechanism: null,
    status: "active",
    metadata: sanitizeMetadata(args.metadata),
    updated_at: now,
  };
  await args.db
    .insert(brainArtifactManifests)
    .values(values)
    .onConflictDoUpdate({
      target: brainArtifactManifests.manifest_uri,
      set: values,
    });
}

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] =
      /secret|token|password|credential|authorization|cookie|api[_-]?key/i.test(
        key,
      )
        ? "[redacted]"
        : sanitizeMetadata(child);
  }
  return output;
}

function sanitizeSegment(segment: string): string {
  const sanitized = segment.replace(/[^a-zA-Z0-9._=-]+/g, "_").slice(0, 96);
  return sanitized || "unknown";
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
