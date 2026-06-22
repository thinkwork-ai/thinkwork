import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { brainArtifactManifests } from "@thinkwork/database-pg/schema";
import { createHash } from "node:crypto";
import type { Database } from "../db.js";
import type { KnowledgeGraphIngestRunRow } from "../../graphql/resolvers/knowledge-graph/mappers.js";
import type { KnowledgeGraphOntologyExport } from "./ontology-export.js";
import type { KnowledgeGraphSourceBundle } from "./source-adapters.js";

export type BrainArtifactManifestKind =
  | "source_artifact"
  | "ingestion_manifest"
  | "migration_snapshot"
  | "vault_projection"
  | "export"
  | "okf_bundle"
  | "okf_current_manifest";

export type BrainArtifactSourceKind =
  | "thread"
  | "wiki"
  | "brain"
  | "observations"
  | "okf";

type BrainArtifactS3Client = Pick<S3Client, "send">;

interface ArtifactObject {
  kind: BrainArtifactManifestKind;
  key: string;
  uri: string;
  versionId: string | null;
  checksumSha256: string;
  byteLength: number;
  contentType: string;
  contentEncoding: string | null;
}

export interface BrainArtifactWriteResult {
  enabled: boolean;
  sourceArtifact?: ArtifactObject;
  ingestionManifest?: ArtifactObject;
  vaultProjection?: ArtifactObject;
}

export interface WriteKnowledgeGraphIngestArtifactsArgs {
  db: Database;
  s3?: BrainArtifactS3Client;
  bucket?: string | null;
  run: KnowledgeGraphIngestRunRow;
  source: KnowledgeGraphSourceBundle;
  ontology: KnowledgeGraphOntologyExport;
  ingest?: {
    datasetId?: string | null;
    pipelineRunId?: string | null;
    mode?: string | null;
  };
  indexing?: {
    status?: string | null;
    rawStatus?: string | null;
    attempts?: number | null;
    elapsedMs?: number | null;
  };
}

export interface WriteVaultProjectionArtifactArgs {
  db: Database;
  s3?: BrainArtifactS3Client;
  bucket?: string | null;
  tenantId: string;
  sourceRef: string;
  sourceLabel: string;
  sourceIds: string[];
  body: Buffer;
  date: string;
  contentType?: string;
  contentEncoding?: string | null;
  sourceKind?: "thread" | "wiki" | "brain" | "observations";
  sourceType?: string;
  metadata?: Record<string, unknown>;
}

const REGION = process.env.AWS_REGION || "us-east-1";

const ARTIFACT_ROOTS: Record<BrainArtifactManifestKind, string> = {
  source_artifact: "source-artifacts",
  ingestion_manifest: "ingestion-manifests",
  migration_snapshot: "migration-snapshots",
  vault_projection: "vault-projections",
  export: "exports",
  okf_bundle: "okf-bundles",
  okf_current_manifest: "okf-current-manifests",
};

export async function writeKnowledgeGraphIngestArtifacts(
  args: WriteKnowledgeGraphIngestArtifactsArgs,
): Promise<BrainArtifactWriteResult> {
  const bucket = args.bucket ?? process.env.BRAIN_ARTIFACTS_BUCKET ?? null;
  if (!bucket) return { enabled: false };

  try {
    const s3 = args.s3 ?? new S3Client({ region: REGION });
    const sourceIds = sourceIdsForBundle(args.source);
    const sourceType = sourceTypeForBundle(args.source);
    const sourceHash = sourceHashFor(args.source.sourceRef, sourceIds);
    const sourceBody = Buffer.from(args.source.document, "utf8");
    const sourceKey = brainArtifactKey({
      kind: "source_artifact",
      tenantId: args.run.tenant_id,
      sourceKind: args.source.sourceKind,
      runId: args.run.id,
      filename: "source.md",
    });
    const sourceArtifact = await putArtifactObject({
      s3,
      bucket,
      kind: "source_artifact",
      key: sourceKey,
      body: sourceBody,
      contentType: "text/markdown; charset=utf-8",
    });

    const manifestPayload = {
      schemaVersion: "thinkwork.company_brain.artifact_manifest.v1",
      createdAt: new Date().toISOString(),
      tenantId: args.run.tenant_id,
      ingestRunId: args.run.id,
      source: {
        kind: args.source.sourceKind,
        ref: args.source.sourceRef,
        label: args.source.sourceLabel,
        type: sourceType,
        ids: sourceIds,
      },
      ontology: {
        mechanism: args.ontology.mechanism,
        version: ontologyVersion(args.ontology),
        key: args.ontology.ontologyKey,
      },
      embedding: embeddingConfig(),
      cognee: {
        datasetName: args.run.cognee_dataset_name,
        datasetId: args.ingest?.datasetId ?? null,
        pipelineRunId: args.ingest?.pipelineRunId ?? null,
        ingestMode: args.ingest?.mode ?? null,
        indexStatus: args.indexing?.status ?? null,
        indexRawStatus: args.indexing?.rawStatus ?? null,
        indexAttempts: args.indexing?.attempts ?? null,
        indexElapsedMs: args.indexing?.elapsedMs ?? null,
      },
      artifacts: [
        {
          kind: sourceArtifact.kind,
          uri: sourceArtifact.uri,
          versionId: sourceArtifact.versionId,
          checksumSha256: sourceArtifact.checksumSha256,
          byteLength: sourceArtifact.byteLength,
          contentType: sourceArtifact.contentType,
          contentEncoding: sourceArtifact.contentEncoding,
        },
      ],
      sourceMetrics: sanitizeForManifest({
        packetCount: args.source.packetCount,
        relationshipCount: args.source.relationships.length,
        evidenceCount: args.source.evidence.length,
        skippedCount: args.source.skippedCount,
        diagnostics: args.source.diagnostics,
      }),
    };
    const manifestBody = Buffer.from(
      JSON.stringify(manifestPayload, null, 2),
      "utf8",
    );
    const manifestKey = brainArtifactKey({
      kind: "ingestion_manifest",
      tenantId: args.run.tenant_id,
      sourceKind: args.source.sourceKind,
      runId: args.run.id,
      filename: "manifest.json",
    });
    const ingestionManifest = await putArtifactObject({
      s3,
      bucket,
      kind: "ingestion_manifest",
      key: manifestKey,
      body: manifestBody,
      contentType: "application/json; charset=utf-8",
    });

    const common = {
      db: args.db,
      tenantId: args.run.tenant_id,
      ingestRunId: args.run.id,
      sourceKind: args.source.sourceKind,
      sourceType,
      sourceIds,
      sourceIdHash: sourceHash,
      sourceCount: sourceIds.length,
      ontologyVersion: ontologyVersion(args.ontology),
      ontologyMechanism: args.ontology.mechanism,
      embeddingModel: embeddingConfig().model,
      vectorDimension: embeddingConfig().vectorDimension,
    };
    await upsertArtifactManifestRecord({
      ...common,
      artifact: sourceArtifact,
      artifactRootUri: rootUri(bucket, "source_artifact", args.run.tenant_id),
      objectCount: 1,
      metadata: {
        recordKind: "source_artifact",
        sourceLabel: args.source.sourceLabel,
      },
    });
    await upsertArtifactManifestRecord({
      ...common,
      artifact: ingestionManifest,
      artifactRootUri: rootUri(bucket, "source_artifact", args.run.tenant_id),
      objectCount: 2,
      metadata: {
        recordKind: "ingestion_manifest",
        sourceArtifactUri: sourceArtifact.uri,
      },
    });

    return { enabled: true, sourceArtifact, ingestionManifest };
  } catch (error) {
    throw new Error(
      `Company Brain artifact write failed: ${redactArtifactError(error)}`,
    );
  }
}

export async function writeVaultProjectionArtifact(
  args: WriteVaultProjectionArtifactArgs,
): Promise<BrainArtifactWriteResult> {
  const bucket = args.bucket ?? process.env.BRAIN_ARTIFACTS_BUCKET ?? null;
  if (!bucket) return { enabled: false };

  try {
    const s3 = args.s3 ?? new S3Client({ region: REGION });
    const sourceHash = sourceHashFor(args.sourceRef, args.sourceIds);
    const key = [
      ARTIFACT_ROOTS.vault_projection,
      sanitizeSegment(args.tenantId),
      sourceHash,
      sanitizeSegment(args.date),
      "vault.md.gz",
    ].join("/");
    const vaultProjection = await putArtifactObject({
      s3,
      bucket,
      kind: "vault_projection",
      key,
      body: args.body,
      contentType: args.contentType ?? "application/gzip",
      contentEncoding: args.contentEncoding ?? "gzip",
    });
    await upsertArtifactManifestRecord({
      db: args.db,
      tenantId: args.tenantId,
      ingestRunId: null,
      sourceKind: args.sourceKind ?? "wiki",
      sourceType: args.sourceType ?? "wiki_vault_projection",
      sourceIds: args.sourceIds,
      sourceIdHash: sourceHash,
      sourceCount: args.sourceIds.length,
      artifact: vaultProjection,
      objectCount: 1,
      vaultProjectionRootUri: rootUri(
        bucket,
        "vault_projection",
        args.tenantId,
      ),
      metadata: sanitizeMetadataRecord({
        ...args.metadata,
        sourceLabel: args.sourceLabel,
      }),
    });
    return { enabled: true, vaultProjection };
  } catch (error) {
    throw new Error(
      `Company Brain vault projection write failed: ${redactArtifactError(
        error,
      )}`,
    );
  }
}

export function sourceIdsForBundle(
  source: KnowledgeGraphSourceBundle,
): string[] {
  const ids = new Set<string>();
  for (const packet of source.packets) ids.add(packet.id);
  for (const evidence of source.evidence) {
    if (evidence.evidenceSourceRef) ids.add(evidence.evidenceSourceRef);
    else ids.add(evidence.id);
  }
  return [...ids].sort();
}

export function sourceHashFor(sourceRef: string, sourceIds: string[]): string {
  return sha256Hex([sourceRef, ...sourceIds].join("\n"));
}

export function redactArtifactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/s3:\/\/[^\s"'`]+/g, "s3://[redacted]")
    .replace(
      /\b(?:source-artifacts|ingestion-manifests|migration-snapshots|vault-projections|exports|okf-bundles|okf-current-manifests)\/[^\s"'`,}]+/g,
      "[redacted-s3-key]",
    )
    .replace(/\b[a-z0-9.-]*brain-artifacts[a-z0-9.-]*\b/gi, "[redacted-bucket]")
    .replace(
      /((?:source[-_ ]?id|sourceRef|source_ref)[=:])[^\s"'`,}]+/gi,
      "$1[redacted]",
    );
}

export function redactedSourceRef(sourceRef: string): string {
  return sha256Hex(sourceRef).slice(0, 16);
}

async function putArtifactObject(args: {
  s3: BrainArtifactS3Client;
  bucket: string;
  kind: BrainArtifactManifestKind;
  key: string;
  body: Buffer;
  contentType: string;
  contentEncoding?: string | null;
}): Promise<ArtifactObject> {
  const checksumSha256 = sha256Hex(args.body);
  const output = await args.s3.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      ContentEncoding: args.contentEncoding ?? undefined,
      Metadata: {
        checksum_sha256: checksumSha256,
        artifact_kind: args.kind,
      },
    }),
  );
  return {
    kind: args.kind,
    key: args.key,
    uri: `s3://${args.bucket}/${args.key}`,
    versionId:
      "VersionId" in output && typeof output.VersionId === "string"
        ? output.VersionId
        : null,
    checksumSha256,
    byteLength: args.body.byteLength,
    contentType: args.contentType,
    contentEncoding: args.contentEncoding ?? null,
  };
}

async function upsertArtifactManifestRecord(args: {
  db: Database;
  tenantId: string;
  ingestRunId: string | null;
  sourceKind: BrainArtifactSourceKind;
  sourceType: string;
  sourceIds: string[];
  sourceIdHash: string;
  sourceCount: number;
  artifact: ArtifactObject;
  objectCount: number;
  artifactRootUri?: string | null;
  vaultProjectionRootUri?: string | null;
  ontologyVersion?: string | null;
  ontologyMechanism?: string | null;
  embeddingModel?: string | null;
  vectorDimension?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  const values = {
    tenant_id: args.tenantId,
    ingest_run_id: args.ingestRunId,
    manifest_kind: args.artifact.kind,
    source_family: args.sourceKind,
    source_kind: args.sourceKind,
    source_type: args.sourceType,
    source_ids: args.sourceIds,
    source_id_hash: args.sourceIdHash,
    manifest_uri: args.artifact.uri,
    artifact_root_uri: args.artifactRootUri ?? null,
    vault_projection_root_uri: args.vaultProjectionRootUri ?? null,
    object_version_id: args.artifact.versionId,
    content_type: args.artifact.contentType,
    content_encoding: args.artifact.contentEncoding,
    byte_length: args.artifact.byteLength,
    checksum_sha256: args.artifact.checksumSha256,
    object_count: args.objectCount,
    source_count: args.sourceCount,
    embedding_model: args.embeddingModel ?? null,
    vector_dimension: args.vectorDimension ?? null,
    ontology_version: args.ontologyVersion ?? null,
    ontology_mechanism: args.ontologyMechanism ?? null,
    status: "active",
    metadata: sanitizeForManifest(args.metadata ?? {}),
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

function brainArtifactKey(args: {
  kind: BrainArtifactManifestKind;
  tenantId: string;
  sourceKind: string;
  runId: string;
  filename: string;
}): string {
  return [
    ARTIFACT_ROOTS[args.kind],
    sanitizeSegment(args.tenantId),
    sanitizeSegment(args.sourceKind),
    sanitizeSegment(args.runId),
    args.filename,
  ].join("/");
}

function rootUri(
  bucket: string,
  kind: BrainArtifactManifestKind,
  tenantId: string,
): string {
  return `s3://${bucket}/${ARTIFACT_ROOTS[kind]}/${sanitizeSegment(tenantId)}/`;
}

function sourceTypeForBundle(source: KnowledgeGraphSourceBundle): string {
  if (source.sourceKind === "thread") return "thread_message";
  if (source.sourceKind === "wiki") return "wiki_page";
  if (source.sourceKind === "brain") return "brain_page";
  if (source.sourceKind === "observations") return "hindsight_observation";
  return source.sourceKind;
}

function ontologyVersion(ontology: KnowledgeGraphOntologyExport): string {
  if (ontology.ontologyKey) return ontology.ontologyKey;
  const content = JSON.stringify({
    mechanism: ontology.mechanism,
    entityTypes: ontology.entityTypes.map((type) => type.slug),
    relationshipTypes: ontology.relationshipTypes.map((type) => type.slug),
  });
  return `inline:${sha256Hex(content).slice(0, 16)}`;
}

function embeddingConfig(): {
  model: string | null;
  vectorDimension: number | null;
} {
  const model =
    process.env.BRAIN_EMBEDDING_MODEL ??
    process.env.COGNEE_EMBEDDING_MODEL ??
    null;
  const rawDimension =
    process.env.BRAIN_VECTOR_DIMENSION ?? process.env.COGNEE_VECTOR_DIMENSION;
  const vectorDimension = rawDimension
    ? Number.parseInt(rawDimension, 10)
    : NaN;
  return {
    model,
    vectorDimension: Number.isFinite(vectorDimension) ? vectorDimension : null,
  };
}

function sanitizeForManifest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForManifest);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretishKey(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = sanitizeForManifest(child);
    }
  }
  return output;
}

function sanitizeMetadataRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeForManifest(value) as Record<string, unknown>;
}

function isSecretishKey(key: string): boolean {
  return /secret|token|password|credential|authorization|cookie|api[_-]?key/i.test(
    key,
  );
}

function sanitizeSegment(segment: string): string {
  const sanitized = segment.replace(/[^a-zA-Z0-9._=-]+/g, "_").slice(0, 96);
  return sanitized || "unknown";
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
