import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  kgEntities,
  kgEvidence,
  kgIngestRuns,
  kgRelationships,
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
    eq(kgIngestRuns.id, args.runId),
    eq(kgIngestRuns.tenant_id, args.tenantId),
  ];
  if (args.threadId) {
    predicates.push(eq(kgIngestRuns.thread_id, args.threadId));
  }
  if (args.sourceKind) {
    predicates.push(eq(kgIngestRuns.source_kind, args.sourceKind));
  }
  if (args.sourceRef) {
    predicates.push(eq(kgIngestRuns.source_ref, args.sourceRef));
  }
  const [row] = await args.db
    .select()
    .from(kgIngestRuns)
    .where(and(...predicates))
    .limit(1);
  return (row as KnowledgeGraphIngestRunRow | undefined) ?? null;
}

export async function markKnowledgeGraphRunRunning(args: {
  db: Database;
  runId: string;
}): Promise<void> {
  await args.db
    .update(kgIngestRuns)
    .set({
      status: "running",
      started_at: new Date(),
      updated_at: new Date(),
      error: null,
    })
    .where(
      and(
        eq(kgIngestRuns.id, args.runId),
        sql`${kgIngestRuns.status} IN ('queued','running')`,
      ),
    );
}

/** Finish a run that found no new source records — cursors stay untouched. */
export async function markKnowledgeGraphRunStaleNoop(args: {
  db: Database;
  runId: string;
  startedAt: Date;
  metrics?: Record<string, unknown>;
}): Promise<void> {
  const finishedAt = new Date();
  await args.db
    .update(kgIngestRuns)
    .set({
      status: "stale_noop",
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
      metrics: args.metrics ?? {},
      updated_at: finishedAt,
    })
    .where(eq(kgIngestRuns.id, args.runId));
}

export async function countKnowledgeGraphEntitiesForSource(args: {
  db: Database;
  tenantId: string;
  sourceKind: string;
  sourceRef: string;
}): Promise<number> {
  const [row] = await args.db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(kgEntities)
    .where(
      and(
        eq(kgEntities.tenant_id, args.tenantId),
        eq(kgEntities.source_kind, args.sourceKind),
        eq(kgEntities.source_ref, args.sourceRef),
      ),
    );
  return Number(row?.count ?? 0);
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
    .update(kgIngestRuns)
    .set({
      status: "failed",
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
      error: args.error.slice(0, 4000),
      metrics: args.metrics ?? {},
      updated_at: finishedAt,
    })
    .where(eq(kgIngestRuns.id, args.runId));
}

/** Drizzle transaction handle as passed to `db.transaction` callbacks. */
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function replaceKnowledgeGraphSnapshot(args: {
  db: Database;
  run: KnowledgeGraphIngestRunRow;
  snapshot: NormalizedKnowledgeGraphSnapshot;
  sourceDatasetId: string | null;
  startedAt: Date;
  ingestMode: string;
  ontologyMechanism: string;
  sourceMetrics?: Record<string, unknown>;
  /** Merged over the run's existing metadata in the completion update. */
  runMetadata?: Record<string, unknown>;
  /**
   * Extra writes that must commit atomically with the snapshot replace +
   * run completion (e.g. observation cursor advance) — a split commit
   * makes cursors-ahead silent data loss.
   */
  extraWork?: (tx: DatabaseTransaction) => Promise<void>;
}): Promise<void> {
  const finishedAt = new Date();
  await args.db.transaction(async (tx) => {
    await tx
      .delete(kgEvidence)
      .where(
        and(
          eq(kgEvidence.tenant_id, args.run.tenant_id),
          eq(kgEvidence.source_kind, args.run.source_kind),
          eq(kgEvidence.source_ref, args.run.source_ref),
        ),
      );
    await tx
      .delete(kgRelationships)
      .where(
        and(
          eq(kgRelationships.tenant_id, args.run.tenant_id),
          eq(kgRelationships.source_kind, args.run.source_kind),
          eq(kgRelationships.source_ref, args.run.source_ref),
        ),
      );
    await tx
      .delete(kgEntities)
      .where(
        and(
          eq(kgEntities.tenant_id, args.run.tenant_id),
          eq(kgEntities.source_kind, args.run.source_kind),
          eq(kgEntities.source_ref, args.run.source_ref),
        ),
      );

    const insertedEntities = args.snapshot.entities.length
      ? await tx
          .insert(kgEntities)
          .values(
            args.snapshot.entities.map((entity) => ({
              tenant_id: args.run.tenant_id,
              thread_id: args.run.thread_id,
              source_kind: args.run.source_kind,
              source_ref: args.run.source_ref,
              ingest_run_id: args.run.id,
              graph_node_id: entity.graphNodeId,
              label: entity.label,
              normalized_label: entity.normalizedLabel,
              type_label: entity.typeLabel,
              ontology_entity_type_id: entity.ontologyEntityTypeId,
              ontology_type_slug: entity.ontologyTypeSlug,
              grounding_status: entity.groundingStatus,
              provenance_status: entity.provenanceStatus,
              canonical_entity_id: entity.canonicalEntityId ?? null,
              resolution_state: entity.resolutionState ?? "legacy",
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
          .insert(kgRelationships)
          .values(
            args.snapshot.relationships.map((relationship) => ({
              tenant_id: args.run.tenant_id,
              thread_id: args.run.thread_id,
              source_kind: args.run.source_kind,
              source_ref: args.run.source_ref,
              ingest_run_id: args.run.id,
              graph_edge_id: relationship.graphEdgeId,
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
      await tx.insert(kgEvidence).values(evidenceRows);
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
      .update(kgIngestRuns)
      .set({
        status: "succeeded",
        source_dataset_id: args.sourceDatasetId,
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
        ...(args.runMetadata
          ? {
              metadata: {
                ...asRecord(args.run.metadata),
                ...args.runMetadata,
              },
            }
          : {}),
        updated_at: finishedAt,
      })
      .where(eq(kgIngestRuns.id, args.run.id));

    if (args.extraWork) {
      await args.extraWork(tx);
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

/**
 * Delete all mirror rows for one (tenant, source_kind, source_ref) — the
 * merge-upsert path's re-seed lever (fullRebuild). Cursor reset is the
 * caller's responsibility.
 */
export async function purgeKnowledgeGraphSource(args: {
  db: Database;
  tenantId: string;
  sourceKind: string;
  sourceRef: string;
}): Promise<void> {
  await args.db.transaction(async (tx) => {
    for (const table of [kgEvidence, kgRelationships, kgEntities]) {
      await tx
        .delete(table)
        .where(
          and(
            eq(table.tenant_id, args.tenantId),
            eq(table.source_kind, args.sourceKind),
            eq(table.source_ref, args.sourceRef),
          ),
        );
    }
  });
}

function entityMergeKey(
  normalizedLabel: string,
  ontologyTypeSlug: string | null,
): string {
  return `${normalizedLabel} ${ontologyTypeSlug ?? ""}`;
}

function relationshipMergeKey(
  sourceEntityId: string,
  targetEntityId: string,
  typeKey: string,
): string {
  return `${sourceEntityId} ${targetEntityId} ${typeKey}`;
}

/**
 * Incremental merge-upsert of an ingest snapshot into the source mirror
 * (plan 2026-07-03-005 KTD-8).
 *
 * Unlike {@link replaceKnowledgeGraphSnapshot}, this does NOT delete the
 * whole (tenant, source_kind, source_ref) mirror before writing — the
 * observations source shares one source_ref across all runs and each run
 * only sees its cursor-gated new packets, so a replace would wipe the
 * mirror down to the newest batch every sweep. Instead:
 *
 *   - entities keyed on (normalized_label, ontology_type_slug): existing
 *     rows update in place (id preserved), new rows insert;
 *   - relationships keyed on (source_entity_id, target_entity_id, type):
 *     same;
 *   - evidence for touched entities/relationships is replaced (delete then
 *     re-insert this run's rows); untouched rows are left alone;
 *   - denormalized relationship_count / evidence_count are recomputed over
 *     the source scope (display/ranking hints; the promotion gate counts
 *     live from the rows).
 *
 * Absence is NOT deletion: entities that stop appearing in observations
 * remain (append semantics; retraction is a deferred question). A full
 * wipe is `fullRebuild` (delete-by-source_ref + cursor reset) in the
 * handler.
 */
export async function mergeKnowledgeGraphSnapshot(args: {
  db: Database;
  run: KnowledgeGraphIngestRunRow;
  snapshot: NormalizedKnowledgeGraphSnapshot;
  startedAt: Date;
  ingestMode: string;
  ontologyMechanism: string;
  sourceMetrics?: Record<string, unknown>;
  runMetadata?: Record<string, unknown>;
  extraWork?: (tx: DatabaseTransaction) => Promise<void>;
}): Promise<void> {
  const finishedAt = new Date();
  const { run, snapshot } = args;
  await args.db.transaction(async (tx) => {
    // -- Entities: load existing for this source, upsert by merge key ------
    // Merge key is canonical-ID-first (THINK-193 U4): a resolved snapshot
    // entity folds onto the existing mirror row carrying the same canonical
    // id even when the label changed (renames stay one row). Label+type is
    // the fallback: a canonical-resolved entity ADOPTS a legacy same-label
    // row that lacks a canonical id (stamping it — the backfill-before-
    // cutover hazard), and two sides that both lack canonical ids merge on
    // label+type exactly as before.
    const existingEntities = await tx
      .select({
        id: kgEntities.id,
        normalized_label: kgEntities.normalized_label,
        ontology_type_slug: kgEntities.ontology_type_slug,
        canonical_entity_id: kgEntities.canonical_entity_id,
      })
      .from(kgEntities)
      .where(
        and(
          eq(kgEntities.tenant_id, run.tenant_id),
          eq(kgEntities.source_kind, run.source_kind),
          eq(kgEntities.source_ref, run.source_ref),
        ),
      );
    const entityIdByCanonical = new Map<string, string>();
    const legacyEntityIdByKey = new Map<string, string>();
    for (const row of existingEntities) {
      const key = entityMergeKey(row.normalized_label, row.ontology_type_slug);
      if (row.canonical_entity_id) {
        entityIdByCanonical.set(row.canonical_entity_id, row.id);
      } else {
        legacyEntityIdByKey.set(key, row.id);
      }
    }

    const entityIdByTempId = new Map<string, string>();
    const touchedEntityIds = new Set<string>();
    for (const entity of snapshot.entities) {
      const key = entityMergeKey(
        entity.normalizedLabel,
        entity.ontologyTypeSlug,
      );
      const values = {
        tenant_id: run.tenant_id,
        thread_id: run.thread_id,
        source_kind: run.source_kind,
        source_ref: run.source_ref,
        ingest_run_id: run.id,
        graph_node_id: entity.graphNodeId,
        label: entity.label,
        normalized_label: entity.normalizedLabel,
        type_label: entity.typeLabel,
        ontology_entity_type_id: entity.ontologyEntityTypeId,
        ontology_type_slug: entity.ontologyTypeSlug,
        grounding_status: entity.groundingStatus,
        provenance_status: entity.provenanceStatus,
        canonical_entity_id: entity.canonicalEntityId ?? null,
        resolution_state: entity.resolutionState ?? "legacy",
        summary: entity.summary,
        aliases: entity.aliases,
        properties: entity.properties,
        diagnostics: entity.diagnostics,
        last_seen_at: entity.lastSeenAt,
      };
      const existingId = entity.canonicalEntityId
        ? // Canonical first; then adopt a same-key legacy row (stamps it).
          (entityIdByCanonical.get(entity.canonicalEntityId) ??
          legacyEntityIdByKey.get(key))
        : // Both sides lack canonical ids → label+type fallback.
          legacyEntityIdByKey.get(key);
      if (existingId) {
        await tx
          .update(kgEntities)
          .set({ ...values, updated_at: finishedAt })
          .where(eq(kgEntities.id, existingId));
        entityIdByTempId.set(entity.tempId, existingId);
        touchedEntityIds.add(existingId);
        if (entity.canonicalEntityId) {
          entityIdByCanonical.set(entity.canonicalEntityId, existingId);
          legacyEntityIdByKey.delete(key); // adopted — no longer legacy
        }
      } else {
        const [inserted] = await tx
          .insert(kgEntities)
          .values(values)
          .returning({ id: kgEntities.id });
        const newId = inserted!.id;
        // Intra-run duplicates fold together via the canonical/legacy maps.
        if (entity.canonicalEntityId) {
          entityIdByCanonical.set(entity.canonicalEntityId, newId);
        } else {
          legacyEntityIdByKey.set(key, newId);
        }
        entityIdByTempId.set(entity.tempId, newId);
        touchedEntityIds.add(newId);
      }
    }

    // -- Relationships: same merge, keyed on resolved endpoints + type -----
    const existingRelationships = await tx
      .select({
        id: kgRelationships.id,
        source_entity_id: kgRelationships.source_entity_id,
        target_entity_id: kgRelationships.target_entity_id,
        ontology_type_slug: kgRelationships.ontology_type_slug,
        label: kgRelationships.label,
      })
      .from(kgRelationships)
      .where(
        and(
          eq(kgRelationships.tenant_id, run.tenant_id),
          eq(kgRelationships.source_kind, run.source_kind),
          eq(kgRelationships.source_ref, run.source_ref),
        ),
      );
    const relationshipIdByKey = new Map<string, string>();
    for (const row of existingRelationships) {
      relationshipIdByKey.set(
        relationshipMergeKey(
          row.source_entity_id,
          row.target_entity_id,
          row.ontology_type_slug ?? row.label,
        ),
        row.id,
      );
    }

    const relationshipIdByTempId = new Map<string, string>();
    const touchedRelationshipIds = new Set<string>();
    for (const relationship of snapshot.relationships) {
      const sourceId = entityIdByTempId.get(relationship.sourceTempId);
      const targetId = entityIdByTempId.get(relationship.targetTempId);
      if (!sourceId || !targetId) continue; // endpoint dropped by grounding
      const key = relationshipMergeKey(
        sourceId,
        targetId,
        relationship.ontologyTypeSlug ?? relationship.label,
      );
      const values = {
        tenant_id: run.tenant_id,
        thread_id: run.thread_id,
        source_kind: run.source_kind,
        source_ref: run.source_ref,
        ingest_run_id: run.id,
        graph_edge_id: relationship.graphEdgeId,
        source_entity_id: sourceId,
        target_entity_id: targetId,
        label: relationship.label,
        ontology_relationship_type_id: relationship.ontologyRelationshipTypeId,
        ontology_type_slug: relationship.ontologyTypeSlug,
        grounding_status: relationship.groundingStatus,
        provenance_status: relationship.provenanceStatus,
        confidence:
          relationship.confidence === null
            ? null
            : String(relationship.confidence),
        properties: relationship.properties,
        diagnostics: relationship.diagnostics,
        last_seen_at: relationship.lastSeenAt,
      };
      const existingId = relationshipIdByKey.get(key);
      if (existingId) {
        await tx
          .update(kgRelationships)
          .set({ ...values, updated_at: finishedAt })
          .where(eq(kgRelationships.id, existingId));
        relationshipIdByTempId.set(relationship.tempId, existingId);
        touchedRelationshipIds.add(existingId);
      } else {
        const [inserted] = await tx
          .insert(kgRelationships)
          .values(values)
          .returning({ id: kgRelationships.id });
        const newId = inserted!.id;
        relationshipIdByKey.set(key, newId);
        relationshipIdByTempId.set(relationship.tempId, newId);
        touchedRelationshipIds.add(newId);
      }
    }

    // -- Evidence: replace only for touched entities/relationships ---------
    const touchedEntityIdList = [...touchedEntityIds];
    const touchedRelationshipIdList = [...touchedRelationshipIds];
    const evidenceScopePredicates = [];
    if (touchedEntityIdList.length > 0) {
      evidenceScopePredicates.push(
        inArray(kgEvidence.entity_id, touchedEntityIdList),
      );
    }
    if (touchedRelationshipIdList.length > 0) {
      evidenceScopePredicates.push(
        inArray(kgEvidence.relationship_id, touchedRelationshipIdList),
      );
    }
    if (evidenceScopePredicates.length > 0) {
      await tx
        .delete(kgEvidence)
        .where(
          and(
            eq(kgEvidence.tenant_id, run.tenant_id),
            eq(kgEvidence.source_kind, run.source_kind),
            eq(kgEvidence.source_ref, run.source_ref),
            or(...evidenceScopePredicates),
          ),
        );
    }
    const evidenceRows = snapshot.evidence
      .map((evidence) =>
        toEvidenceRow({
          evidence,
          run,
          entityIdByTempId,
          relationshipIdByTempId,
        }),
      )
      .filter((row) => row.entity_id || row.relationship_id);
    if (evidenceRows.length) {
      await tx.insert(kgEvidence).values(evidenceRows);
    }

    // -- Recompute denormalized counts over the source scope ---------------
    // (display/ranking hints — the promotion gate counts live from rows).
    await tx.execute(sql`
      UPDATE kg.entities e SET
        relationship_count = (
          SELECT count(*) FROM kg.relationships r
          WHERE r.source_entity_id = e.id OR r.target_entity_id = e.id
        ),
        evidence_count = (
          SELECT count(*) FROM kg.evidence ev
          WHERE ev.entity_id = e.id
        ),
        updated_at = ${finishedAt}
      WHERE e.tenant_id = ${run.tenant_id}
        AND e.source_kind = ${run.source_kind}
        AND e.source_ref = ${run.source_ref}
    `);

    // -- Run completion: report THIS run's contribution --------------------
    const diagnosticCount =
      snapshot.entities.filter(
        (entity) =>
          entity.groundingStatus !== "grounded" ||
          entity.provenanceStatus !== "strong",
      ).length +
      snapshot.relationships.filter(
        (relationship) =>
          relationship.groundingStatus !== "grounded" ||
          relationship.provenanceStatus !== "strong",
      ).length;

    await tx
      .update(kgIngestRuns)
      .set({
        status: "succeeded",
        source_dataset_id: null,
        finished_at: finishedAt,
        duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
        entity_count: snapshot.entities.length,
        relationship_count: snapshot.relationships.length,
        evidence_count: evidenceRows.length,
        diagnostic_count: diagnosticCount,
        metrics: {
          ...(args.sourceMetrics ?? {}),
          ...snapshot.metrics,
          ingestMode: args.ingestMode,
          ontologyMechanism: args.ontologyMechanism,
          writeMode: "merge_upsert",
          mergedEntityCount: touchedEntityIds.size,
          mergedRelationshipCount: touchedRelationshipIds.size,
        },
        ...(args.runMetadata
          ? {
              metadata: {
                ...asRecord(run.metadata),
                ...args.runMetadata,
              },
            }
          : {}),
        updated_at: finishedAt,
      })
      .where(eq(kgIngestRuns.id, run.id));

    if (args.extraWork) {
      await args.extraWork(tx);
    }
  });
}
