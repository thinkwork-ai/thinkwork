/**
 * Agent-facing knowledge-graph traversal: entity detail + bounded
 * neighborhood expansion (THINK-133 U6, R10/KTD-6).
 *
 * Same hard scope rules as graph-search.ts: tenant-scoped, ONLY
 * `source_kind='observations'`, `grounding_status='grounded'`, and NO
 * evidence snippets — labels, summaries, and observation-ID references only
 * (R17). Neighborhood expansion is a depth-bounded recursive CTE (R1) with
 * SQL row caps re-enforced in JS.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../db.js";
import type {
  KnowledgeGraphSearchEntity,
  KnowledgeGraphSearchRelationship,
  KnowledgeGraphSearchResult,
} from "./graph-search.js";

export const DEFAULT_NEIGHBOR_DEPTH = 1;
export const MAX_NEIGHBOR_DEPTH = 2;
export const MAX_NEIGHBOR_EDGES = 25;
export const MAX_NEIGHBOR_ENTITIES = 20;
const MAX_OBSERVATION_REF_ROWS = 200;
const MAX_OBSERVATION_IDS_PER_ENTITY = 10;

const AGENT_SOURCE_KIND = "observations";

interface EntityRow {
  id: string;
  source_kind: string;
  label: string;
  ontology_type_slug: string | null;
  summary: string | null;
  aliases: string[] | null;
  relationship_count: number;
  evidence_count: number;
}

interface EdgeRow {
  id: string;
  source_kind: string;
  label: string;
  ontology_type_slug: string | null;
  source_entity_id: string;
  target_entity_id: string;
  from_label: string;
  to_label: string;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function clampDepth(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_NEIGHBOR_DEPTH;
  return Math.max(1, Math.min(MAX_NEIGHBOR_DEPTH, Math.floor(value!)));
}

function toEntity(
  row: EntityRow,
  observationIds: string[],
): KnowledgeGraphSearchEntity {
  return {
    id: row.id,
    label: row.label,
    typeSlug: row.ontology_type_slug,
    summary: row.summary,
    aliases: row.aliases ?? [],
    relationshipCount: Number(row.relationship_count) || 0,
    evidenceCount: Number(row.evidence_count) || 0,
    observationIds,
  };
}

function toRelationship(row: EdgeRow): KnowledgeGraphSearchRelationship {
  return {
    id: row.id,
    label: row.label,
    typeSlug: row.ontology_type_slug,
    fromLabel: row.from_label,
    toLabel: row.to_label,
  };
}

async function loadEntitiesByIds(
  db: Database,
  tenantId: string,
  entityIds: string[],
): Promise<EntityRow[]> {
  if (entityIds.length === 0) return [];
  const idList = sql.join(
    entityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await db.execute(sql`
    SELECT id, source_kind, label, ontology_type_slug, summary, aliases,
           relationship_count, evidence_count
      FROM knowledge_graph_entities
     WHERE tenant_id = ${tenantId}
       AND source_kind = ${AGENT_SOURCE_KIND}
       AND grounding_status = 'grounded'
       AND id IN (${idList})
     LIMIT ${MAX_NEIGHBOR_ENTITIES}
  `);
  return rowsOf<EntityRow>(result).filter(
    (row) => row.source_kind === AGENT_SOURCE_KIND,
  );
}

async function loadObservationIds(
  db: Database,
  tenantId: string,
  entityIds: string[],
): Promise<Map<string, string[]>> {
  const observationIdsByEntity = new Map<string, string[]>();
  if (entityIds.length === 0) return observationIdsByEntity;
  const idList = sql.join(
    entityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Observation-ID refs only — never selects `snippet` (R17).
  const result = await db.execute(sql`
    SELECT entity_id, evidence_source_ref
      FROM knowledge_graph_evidence
     WHERE tenant_id = ${tenantId}
       AND source_kind = ${AGENT_SOURCE_KIND}
       AND evidence_source_kind = 'hindsight_observation'
       AND evidence_source_ref IS NOT NULL
       AND entity_id IN (${idList})
     LIMIT ${MAX_OBSERVATION_REF_ROWS}
  `);
  for (const row of rowsOf<{
    entity_id: string;
    evidence_source_ref: string;
  }>(result)) {
    if (!row.entity_id || !row.evidence_source_ref) continue;
    const ids = observationIdsByEntity.get(row.entity_id) ?? [];
    if (
      ids.length < MAX_OBSERVATION_IDS_PER_ENTITY &&
      !ids.includes(row.evidence_source_ref)
    ) {
      ids.push(row.evidence_source_ref);
    }
    observationIdsByEntity.set(row.entity_id, ids);
  }
  return observationIdsByEntity;
}

/**
 * Entity detail by id: the entity plus its bounded 1-hop edges. Unknown or
 * out-of-scope ids yield an empty result, not an error.
 */
export async function getKnowledgeGraphEntityDetail(args: {
  db: Database;
  tenantId: string;
  entityId: string;
}): Promise<KnowledgeGraphSearchResult> {
  const entities = await loadEntitiesByIds(args.db, args.tenantId, [
    args.entityId,
  ]);
  if (entities.length === 0) {
    return { entities: [], relationships: [] };
  }

  const edgeResult = await args.db.execute(sql`
    SELECT r.id, r.source_kind, r.label, r.ontology_type_slug,
           r.source_entity_id, r.target_entity_id,
           se.label AS from_label, te.label AS to_label
      FROM knowledge_graph_relationships r
      JOIN knowledge_graph_entities se ON se.id = r.source_entity_id
      JOIN knowledge_graph_entities te ON te.id = r.target_entity_id
     WHERE r.tenant_id = ${args.tenantId}
       AND r.source_kind = ${AGENT_SOURCE_KIND}
       AND r.grounding_status = 'grounded'
       AND (
         r.source_entity_id = ${args.entityId}::uuid
         OR r.target_entity_id = ${args.entityId}::uuid
       )
     ORDER BY r.evidence_count DESC, r.label ASC
     LIMIT ${MAX_NEIGHBOR_EDGES}
  `);
  const edges = rowsOf<EdgeRow>(edgeResult)
    .filter((row) => row.source_kind === AGENT_SOURCE_KIND)
    .slice(0, MAX_NEIGHBOR_EDGES);

  const observationIds = await loadObservationIds(args.db, args.tenantId, [
    args.entityId,
  ]);
  return {
    entities: entities.map((row) =>
      toEntity(row, observationIds.get(row.id) ?? []),
    ),
    relationships: edges.map(toRelationship),
  };
}

/**
 * Depth-bounded neighborhood expansion from an anchor entity. The recursive
 * CTE walks edges up to `depth` hops (max {@link MAX_NEIGHBOR_DEPTH}),
 * hard-capped at {@link MAX_NEIGHBOR_EDGES} edges; neighbor entities are
 * returned with their observation-ID refs. The anchor itself is included.
 */
export async function getKnowledgeGraphNeighbors(args: {
  db: Database;
  tenantId: string;
  entityId: string;
  depth?: number | null;
}): Promise<KnowledgeGraphSearchResult> {
  const depth = clampDepth(args.depth);

  const edgeResult = await args.db.execute(sql`
    WITH RECURSIVE walk(entity_id, hop) AS (
      SELECT ${args.entityId}::uuid, 0
      UNION
      SELECT CASE
               WHEN r.source_entity_id = walk.entity_id THEN r.target_entity_id
               ELSE r.source_entity_id
             END,
             walk.hop + 1
        FROM knowledge_graph_relationships r
        JOIN walk ON walk.hop < ${depth}
         AND (r.source_entity_id = walk.entity_id OR r.target_entity_id = walk.entity_id)
       WHERE r.tenant_id = ${args.tenantId}
         AND r.source_kind = ${AGENT_SOURCE_KIND}
         AND r.grounding_status = 'grounded'
    )
    SELECT DISTINCT r.id, r.source_kind, r.label, r.ontology_type_slug,
           r.source_entity_id, r.target_entity_id,
           se.label AS from_label, te.label AS to_label
      FROM knowledge_graph_relationships r
      JOIN knowledge_graph_entities se ON se.id = r.source_entity_id
      JOIN knowledge_graph_entities te ON te.id = r.target_entity_id
     WHERE r.tenant_id = ${args.tenantId}
       AND r.source_kind = ${AGENT_SOURCE_KIND}
       AND r.grounding_status = 'grounded'
       AND (
         r.source_entity_id IN (SELECT entity_id FROM walk)
         OR r.target_entity_id IN (SELECT entity_id FROM walk)
       )
     LIMIT ${MAX_NEIGHBOR_EDGES}
  `);
  const edges = rowsOf<EdgeRow>(edgeResult)
    .filter((row) => row.source_kind === AGENT_SOURCE_KIND)
    .slice(0, MAX_NEIGHBOR_EDGES);

  const neighborIds = new Set<string>([args.entityId]);
  for (const edge of edges) {
    neighborIds.add(edge.source_entity_id);
    neighborIds.add(edge.target_entity_id);
  }
  const entityIds = [...neighborIds].slice(0, MAX_NEIGHBOR_ENTITIES);
  const entities = await loadEntitiesByIds(args.db, args.tenantId, entityIds);
  const observationIds = await loadObservationIds(
    args.db,
    args.tenantId,
    entityIds,
  );

  return {
    entities: entities.map((row) =>
      toEntity(row, observationIds.get(row.id) ?? []),
    ),
    relationships: edges.map(toRelationship),
  };
}
