import { and, eq, sql } from "drizzle-orm";
import {
  knowledgeGraphEntities,
  knowledgeGraphEvidence,
  knowledgeGraphIngestRuns,
  knowledgeGraphRelationships,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import type { KnowledgeGraphIngestRunRow } from "../../graphql/resolvers/knowledge-graph/mappers.js";
import type {
  NormalizedKnowledgeGraphEvidence,
  NormalizedKnowledgeGraphSnapshot,
} from "./normalizer.js";

export async function loadKnowledgeGraphIngestRun(args: {
  db: Database;
  runId: string;
  tenantId: string;
  threadId?: string | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
}): Promise<KnowledgeGraphIngestRunRow | null> {
  const predicates = [
    eq(knowledgeGraphIngestRuns.id, args.runId),
    eq(knowledgeGraphIngestRuns.tenant_id, args.tenantId),
  ];
  if (args.threadId) {
    predicates.push(eq(knowledgeGraphIngestRuns.thread_id, args.threadId));
  }
  if (args.sourceKind) {
    predicates.push(eq(knowledgeGraphIngestRuns.source_kind, args.sourceKind));
  }
  if (args.sourceRef) {
    predicates.push(eq(knowledgeGraphIngestRuns.source_ref, args.sourceRef));
  }
  const [row] = await args.db
    .select()
    .from(knowledgeGraphIngestRuns)
    .where(and(...predicates))
    .limit(1);
  return (row as KnowledgeGraphIngestRunRow | undefined) ?? null;
}

export async function markKnowledgeGraphRunRunning(args: {
  db: Database;
  runId: string;
}): Promise<void> {
  await args.db
    .update(knowledgeGraphIngestRuns)
    .set({
      status: "running",
      started_at: new Date(),
      updated_at: new Date(),
      error: null,
    })
    .where(
      and(
        eq(knowledgeGraphIngestRuns.id, args.runId),
        sql`${knowledgeGraphIngestRuns.status} IN ('queued','running')`,
      ),
    );
}

export async function markKnowledgeGraphRunFailed(args: {
  db: Database;
  runId: string;
  startedAt: Date;
  error: string;
  metrics?: Record<string, unknown>;
}): Promise<void> {
  const finishedAt = new Date();
  await args.db
    .update(knowledgeGraphIngestRuns)
    .set({
      status: "failed",
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
      error: args.error.slice(0, 4000),
      metrics: args.metrics ?? {},
      updated_at: finishedAt,
    })
    .where(eq(knowledgeGraphIngestRuns.id, args.runId));
}

export async function replaceKnowledgeGraphSnapshot(args: {
  db: Database;
  run: KnowledgeGraphIngestRunRow;
  snapshot: NormalizedKnowledgeGraphSnapshot;
  cogneeDatasetId: string | null;
  startedAt: Date;
  ingestMode: string;
  ontologyMechanism: string;
  sourceMetrics?: Record<string, unknown>;
}): Promise<void> {
  const finishedAt = new Date();
  await args.db.transaction(async (tx) => {
    await tx
      .delete(knowledgeGraphEvidence)
      .where(
        and(
          eq(knowledgeGraphEvidence.tenant_id, args.run.tenant_id),
          eq(knowledgeGraphEvidence.source_kind, args.run.source_kind),
          eq(knowledgeGraphEvidence.source_ref, args.run.source_ref),
        ),
      );
    await tx
      .delete(knowledgeGraphRelationships)
      .where(
        and(
          eq(knowledgeGraphRelationships.tenant_id, args.run.tenant_id),
          eq(knowledgeGraphRelationships.source_kind, args.run.source_kind),
          eq(knowledgeGraphRelationships.source_ref, args.run.source_ref),
        ),
      );
    await tx
      .delete(knowledgeGraphEntities)
      .where(
        and(
          eq(knowledgeGraphEntities.tenant_id, args.run.tenant_id),
          eq(knowledgeGraphEntities.source_kind, args.run.source_kind),
          eq(knowledgeGraphEntities.source_ref, args.run.source_ref),
        ),
      );

    const insertedEntities = args.snapshot.entities.length
      ? await tx
          .insert(knowledgeGraphEntities)
          .values(
            args.snapshot.entities.map((entity) => ({
              tenant_id: args.run.tenant_id,
              thread_id: args.run.thread_id,
              source_kind: args.run.source_kind,
              source_ref: args.run.source_ref,
              ingest_run_id: args.run.id,
              cognee_node_id: entity.cogneeNodeId,
              label: entity.label,
              normalized_label: entity.normalizedLabel,
              type_label: entity.typeLabel,
              ontology_entity_type_id: entity.ontologyEntityTypeId,
              ontology_type_slug: entity.ontologyTypeSlug,
              grounding_status: entity.groundingStatus,
              provenance_status: entity.provenanceStatus,
              summary: entity.summary,
              aliases: entity.aliases,
              properties: entity.properties,
              diagnostics: entity.diagnostics,
              relationship_count: args.snapshot.relationships.filter(
                (relationship) =>
                  relationship.sourceTempId === entity.tempId ||
                  relationship.targetTempId === entity.tempId,
              ).length,
              evidence_count: args.snapshot.evidence.filter(
                (evidence) => evidence.entityTempId === entity.tempId,
              ).length,
              last_seen_at: entity.lastSeenAt,
            })),
          )
          .returning()
      : [];
    const entityIdByTempId = new Map(
      insertedEntities.map((row, index) => [
        args.snapshot.entities[index]!.tempId,
        row.id,
      ]),
    );

    const insertedRelationships = args.snapshot.relationships.length
      ? await tx
          .insert(knowledgeGraphRelationships)
          .values(
            args.snapshot.relationships.map((relationship) => ({
              tenant_id: args.run.tenant_id,
              thread_id: args.run.thread_id,
              source_kind: args.run.source_kind,
              source_ref: args.run.source_ref,
              ingest_run_id: args.run.id,
              cognee_edge_id: relationship.cogneeEdgeId,
              source_entity_id: entityIdByTempId.get(
                relationship.sourceTempId,
              )!,
              target_entity_id: entityIdByTempId.get(
                relationship.targetTempId,
              )!,
              label: relationship.label,
              ontology_relationship_type_id:
                relationship.ontologyRelationshipTypeId,
              ontology_type_slug: relationship.ontologyTypeSlug,
              grounding_status: relationship.groundingStatus,
              provenance_status: relationship.provenanceStatus,
              confidence:
                relationship.confidence === null
                  ? null
                  : String(relationship.confidence),
              properties: relationship.properties,
              diagnostics: relationship.diagnostics,
              evidence_count: args.snapshot.evidence.filter(
                (evidence) =>
                  evidence.relationshipTempId === relationship.tempId,
              ).length,
              last_seen_at: relationship.lastSeenAt,
            })),
          )
          .returning()
      : [];
    const relationshipIdByTempId = new Map(
      insertedRelationships.map((row, index) => [
        args.snapshot.relationships[index]!.tempId,
        row.id,
      ]),
    );

    const evidenceRows = args.snapshot.evidence
      .map((evidence) =>
        toEvidenceRow({
          evidence,
          run: args.run,
          entityIdByTempId,
          relationshipIdByTempId,
        }),
      )
      .filter((row) => row.entity_id || row.relationship_id);
    if (evidenceRows.length) {
      await tx.insert(knowledgeGraphEvidence).values(evidenceRows);
    }

    const diagnosticCount =
      args.snapshot.entities.filter(
        (entity) =>
          entity.groundingStatus !== "grounded" ||
          entity.provenanceStatus !== "strong",
      ).length +
      args.snapshot.relationships.filter(
        (relationship) =>
          relationship.groundingStatus !== "grounded" ||
          relationship.provenanceStatus !== "strong",
      ).length;

    await tx
      .update(knowledgeGraphIngestRuns)
      .set({
        status: "succeeded",
        cognee_dataset_id: args.cogneeDatasetId,
        finished_at: finishedAt,
        duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
        entity_count: args.snapshot.entities.length,
        relationship_count: args.snapshot.relationships.length,
        evidence_count: evidenceRows.length,
        diagnostic_count: diagnosticCount,
        metrics: {
          ...(args.sourceMetrics ?? {}),
          ...args.snapshot.metrics,
          ingestMode: args.ingestMode,
          ontologyMechanism: args.ontologyMechanism,
        },
        updated_at: finishedAt,
      })
      .where(eq(knowledgeGraphIngestRuns.id, args.run.id));
  });
}

function toEvidenceRow(args: {
  evidence: NormalizedKnowledgeGraphEvidence;
  run: KnowledgeGraphIngestRunRow;
  entityIdByTempId: Map<string, string>;
  relationshipIdByTempId: Map<string, string>;
}) {
  return {
    tenant_id: args.run.tenant_id,
    thread_id: args.run.thread_id,
    source_kind: args.run.source_kind,
    source_ref: args.run.source_ref,
    ingest_run_id: args.run.id,
    entity_id: args.evidence.entityTempId
      ? args.entityIdByTempId.get(args.evidence.entityTempId)
      : null,
    relationship_id: args.evidence.relationshipTempId
      ? args.relationshipIdByTempId.get(args.evidence.relationshipTempId)
      : null,
    message_id: args.evidence.messageId,
    message_role: args.evidence.messageRole,
    message_created_at: args.evidence.messageCreatedAt,
    speaker_label: args.evidence.speakerLabel,
    snippet: args.evidence.snippet,
    char_start: args.evidence.charStart,
    char_end: args.evidence.charEnd,
    evidence_source_kind: args.evidence.sourceKind,
    evidence_source_ref: args.evidence.sourceRef,
    metadata: args.evidence.metadata,
    observed_at: args.evidence.observedAt,
  };
}
