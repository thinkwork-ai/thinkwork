import type {
  KnowledgeGraphEvidenceSourceKind,
  KnowledgeGraphGroundingStatus,
  KnowledgeGraphIngestStatus,
  KnowledgeGraphProvenanceStatus,
  KnowledgeGraphSourceKind,
} from "@thinkwork/database-pg/schema";
import { createHash } from "node:crypto";

type Dateish = Date | string | null | undefined;

export interface KnowledgeGraphIngestRunRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  source_kind: KnowledgeGraphSourceKind | string;
  source_ref: string;
  source_label: string | null;
  requested_by_user_id: string | null;
  status: KnowledgeGraphIngestStatus | string;
  trigger: string;
  cognee_dataset_name: string;
  cognee_dataset_id: string | null;
  started_at: Dateish;
  finished_at: Dateish;
  duration_ms: number | null;
  error: string | null;
  entity_count: number;
  relationship_count: number;
  evidence_count: number;
  diagnostic_count: number;
  message_count: number;
  input: unknown;
  metrics: unknown;
  metadata: unknown;
  created_at: Dateish;
  updated_at: Dateish;
}

export interface KnowledgeGraphArtifactManifestRow {
  id: string;
  tenant_id: string;
  ingest_run_id: string | null;
  manifest_kind: string;
  source_kind: KnowledgeGraphSourceKind | string | null;
  source_type: string | null;
  manifest_uri: string;
  artifact_root_uri: string | null;
  vault_projection_root_uri: string | null;
  checksum_sha256: string | null;
  object_count: number;
  source_count: number;
  content_type: string | null;
  content_encoding: string | null;
  byte_length: number | null;
  embedding_model: string | null;
  vector_dimension: number | null;
  ontology_version: string | null;
  ontology_mechanism: string | null;
  status: string;
  created_at: Dateish;
  updated_at: Dateish;
}

export interface KnowledgeGraphEntityRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  source_kind: KnowledgeGraphSourceKind | string;
  source_ref: string;
  ingest_run_id: string;
  cognee_node_id: string;
  label: string;
  normalized_label: string;
  type_label: string | null;
  ontology_entity_type_id: string | null;
  ontology_type_slug: string | null;
  grounding_status: KnowledgeGraphGroundingStatus | string;
  provenance_status: KnowledgeGraphProvenanceStatus | string;
  summary: string | null;
  aliases: string[] | null;
  properties: unknown;
  diagnostics: unknown;
  relationship_count: number;
  evidence_count: number;
  last_seen_at: Dateish;
  created_at: Dateish;
  updated_at: Dateish;
}

export interface KnowledgeGraphRelationshipRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  source_kind: KnowledgeGraphSourceKind | string;
  source_ref: string;
  ingest_run_id: string;
  cognee_edge_id: string | null;
  source_entity_id: string;
  target_entity_id: string;
  label: string;
  ontology_relationship_type_id: string | null;
  ontology_type_slug: string | null;
  grounding_status: KnowledgeGraphGroundingStatus | string;
  provenance_status: KnowledgeGraphProvenanceStatus | string;
  confidence: string | number | null;
  properties: unknown;
  diagnostics: unknown;
  evidence_count: number;
  last_seen_at: Dateish;
  created_at: Dateish;
  updated_at: Dateish;
}

export interface KnowledgeGraphEvidenceRow {
  id: string;
  tenant_id: string;
  thread_id: string | null;
  source_kind: KnowledgeGraphSourceKind | string;
  source_ref: string;
  ingest_run_id: string;
  entity_id: string | null;
  relationship_id: string | null;
  message_id: string | null;
  message_role: string | null;
  message_created_at: Dateish;
  speaker_label: string | null;
  snippet: string;
  char_start: number | null;
  char_end: number | null;
  evidence_source_kind: KnowledgeGraphEvidenceSourceKind | string;
  evidence_source_ref: string | null;
  metadata: unknown;
  observed_at: Dateish;
  created_at: Dateish;
}

export function serializeIngestRun(
  row: KnowledgeGraphIngestRunRow,
  extra: { artifactManifests?: KnowledgeGraphArtifactManifestRow[] } = {},
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    sourceKind: toGraphqlEnum(row.source_kind),
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    requestedByUserId: row.requested_by_user_id,
    status: toGraphqlEnum(row.status),
    trigger: row.trigger,
    cogneeDatasetName: row.cognee_dataset_name,
    cogneeDatasetId: row.cognee_dataset_id,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    durationMs: row.duration_ms,
    error: row.error,
    entityCount: Number(row.entity_count) || 0,
    relationshipCount: Number(row.relationship_count) || 0,
    evidenceCount: Number(row.evidence_count) || 0,
    diagnosticCount: Number(row.diagnostic_count) || 0,
    messageCount: Number(row.message_count) || 0,
    input: jsonScalar(row.input),
    metrics: jsonScalar(row.metrics),
    metadata: jsonScalar(row.metadata),
    artifactManifests: (extra.artifactManifests ?? []).map(
      serializeArtifactManifestSummary,
    ),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function serializeArtifactManifestSummary(
  row: KnowledgeGraphArtifactManifestRow,
) {
  return {
    id: row.id,
    artifactKind: toGraphqlEnum(row.manifest_kind),
    status: toGraphqlEnum(row.status),
    sourceKind: row.source_kind ? toGraphqlEnum(row.source_kind) : null,
    sourceType: row.source_type,
    objectRef: redactedArtifactRef(row),
    checksumSha256: row.checksum_sha256,
    objectCount: Number(row.object_count) || 0,
    sourceCount: Number(row.source_count) || 0,
    contentType: row.content_type,
    contentEncoding: row.content_encoding,
    byteLength:
      row.byte_length === null || row.byte_length === undefined
        ? null
        : Number(row.byte_length),
    embeddingModel: row.embedding_model,
    vectorDimension:
      row.vector_dimension === null || row.vector_dimension === undefined
        ? null
        : Number(row.vector_dimension),
    ontologyVersion: row.ontology_version,
    ontologyMechanism: row.ontology_mechanism,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function serializeEntity(
  row: KnowledgeGraphEntityRow,
  extra: { relationships?: unknown[]; evidence?: unknown[] } = {},
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    sourceKind: toGraphqlEnum(row.source_kind),
    sourceRef: row.source_ref,
    ingestRunId: row.ingest_run_id,
    cogneeNodeId: row.cognee_node_id,
    label: row.label,
    normalizedLabel: row.normalized_label,
    typeLabel: row.type_label,
    ontologyEntityTypeId: row.ontology_entity_type_id,
    ontologyTypeSlug: row.ontology_type_slug,
    groundingStatus: toGraphqlEnum(row.grounding_status),
    provenanceStatus: toGraphqlEnum(row.provenance_status),
    summary: row.summary,
    aliases: row.aliases ?? [],
    properties: jsonScalar(row.properties),
    diagnostics: jsonScalar(row.diagnostics),
    relationshipCount: Number(row.relationship_count) || 0,
    evidenceCount: Number(row.evidence_count) || 0,
    lastSeenAt: toIso(row.last_seen_at),
    relationships: extra.relationships ?? [],
    evidence: extra.evidence ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function serializeRelationship(
  row: KnowledgeGraphRelationshipRow,
  extra: { evidence?: unknown[] } = {},
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    sourceKind: toGraphqlEnum(row.source_kind),
    sourceRef: row.source_ref,
    ingestRunId: row.ingest_run_id,
    cogneeEdgeId: row.cognee_edge_id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    label: row.label,
    ontologyRelationshipTypeId: row.ontology_relationship_type_id,
    ontologyTypeSlug: row.ontology_type_slug,
    groundingStatus: toGraphqlEnum(row.grounding_status),
    provenanceStatus: toGraphqlEnum(row.provenance_status),
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    properties: jsonScalar(row.properties),
    diagnostics: jsonScalar(row.diagnostics),
    evidenceCount: Number(row.evidence_count) || 0,
    lastSeenAt: toIso(row.last_seen_at),
    evidence: extra.evidence ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function serializeEvidence(row: KnowledgeGraphEvidenceRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    sourceKind: toGraphqlEnum(row.source_kind),
    sourceRef: row.source_ref,
    ingestRunId: row.ingest_run_id,
    entityId: row.entity_id,
    relationshipId: row.relationship_id,
    messageId: row.message_id,
    messageRole: row.message_role,
    messageCreatedAt: toIso(row.message_created_at),
    speakerLabel: row.speaker_label,
    snippet: row.snippet,
    charStart: row.char_start,
    charEnd: row.char_end,
    evidenceSourceKind: toGraphqlEnum(row.evidence_source_kind),
    evidenceSourceRef: row.evidence_source_ref,
    metadata: jsonScalar(row.metadata),
    observedAt: toIso(row.observed_at),
    createdAt: toIso(row.created_at),
  };
}

export function toDbEnum(value: string | null | undefined): string | null {
  return value ? value.toLowerCase() : null;
}

export function toGraphqlEnum(value: string): string {
  return value.toUpperCase();
}

export function toIso(value: Dateish): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function jsonScalar(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function redactedArtifactRef(row: KnowledgeGraphArtifactManifestRow): string {
  const material =
    row.checksum_sha256 ??
    row.manifest_uri ??
    row.artifact_root_uri ??
    row.vault_projection_root_uri ??
    row.id;
  const fingerprint = createHash("sha256")
    .update(String(material))
    .digest("hex")
    .slice(0, 16);
  return `brain-artifact://${row.manifest_kind}/${fingerprint}`;
}
