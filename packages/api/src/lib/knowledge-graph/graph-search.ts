/**
 * Agent-facing knowledge-graph retrieval over the Aurora mirror tables
 * (plan 2026-06-09-004 U7, R13/R17).
 *
 * Scope rules (hard constraints):
 *   - tenant-scoped: every query carries `tenant_id = :tenantId`;
 *   - source-kind filter: ONLY `source_kind = 'observations'` rows are
 *     agent-visible — thread/wiki/brain mirror rows coexist in the same
 *     tables and are excluded from agent reads;
 *   - grounded-only: `grounding_status = 'grounded'` (ontology-approved);
 *   - NO snippets: the result shape carries entity/relationship labels,
 *     summaries, and observation-ID references. Evidence snippets are the
 *     channel that carries raw per-user memory text past the promotion gate;
 *     they stay admin-only (Explorer). This module never selects the
 *     `snippet` column.
 *
 * Bounds: alias-tolerant entity match capped at {@link MAX_ENTITY_LIMIT}
 * entities, then a single bounded 1-hop relationship expansion capped at
 * {@link MAX_RELATIONSHIP_LIMIT} rows — both enforced as SQL LIMITs and
 * re-enforced in JS (defense in depth).
 */

import { sql } from "drizzle-orm";
import type { Database } from "../db.js";

export const DEFAULT_ENTITY_LIMIT = 10;
export const MAX_ENTITY_LIMIT = 10;
export const MAX_RELATIONSHIP_LIMIT = 25;
/** Hard SQL cap on evidence-ref rows scanned for observation ids. */
const MAX_OBSERVATION_REF_ROWS = 200;
/** Per-entity cap on observation ids surfaced to the caller. */
const MAX_OBSERVATION_IDS_PER_ENTITY = 10;

/** The only source kind agent reads may see (R17 / Phase B contract). */
const AGENT_SOURCE_KIND = "observations";

export interface KnowledgeGraphSearchEntity {
  id: string;
  label: string;
  typeSlug: string | null;
  summary: string | null;
  aliases: string[];
  relationshipCount: number;
  evidenceCount: number;
  /** Supporting hindsight observation ids (references, never text). */
  observationIds: string[];
}

export interface KnowledgeGraphSearchRelationship {
  id: string;
  label: string;
  typeSlug: string | null;
  fromLabel: string;
  toLabel: string;
}

export interface KnowledgeGraphSearchResult {
  entities: KnowledgeGraphSearchEntity[];
  relationships: KnowledgeGraphSearchRelationship[];
}

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

interface RelationshipRow {
  id: string;
  source_kind: string;
  label: string;
  ontology_type_slug: string | null;
  from_label: string;
  to_label: string;
}

interface ObservationRefRow {
  entity_id: string;
  evidence_source_ref: string;
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_ENTITY_LIMIT;
  return Math.max(1, Math.min(MAX_ENTITY_LIMIT, Math.floor(value!)));
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Search the tenant's agent-visible knowledge graph: alias-tolerant entity
 * match, bounded 1-hop relationship expansion, and per-entity observation-ID
 * refs. Unknown entities yield an empty result, not an error.
 */
export async function searchKnowledgeGraph(args: {
  db: Database;
  tenantId: string;
  query: string;
  limit?: number | null;
}): Promise<KnowledgeGraphSearchResult> {
  const query = args.query?.trim();
  if (!query) {
    return { entities: [], relationships: [] };
  }
  const limit = clampLimit(args.limit);
  const like = `%${query}%`;
  const normalized = query.toLowerCase();

  const entityResult = await args.db.execute(sql`
    SELECT id, source_kind, label, ontology_type_slug, summary, aliases,
           relationship_count, evidence_count
      FROM knowledge_graph_entities
     WHERE tenant_id = ${args.tenantId}
       AND source_kind = ${AGENT_SOURCE_KIND}
       AND grounding_status = 'grounded'
       AND (
         label ILIKE ${like}
         OR normalized_label ILIKE ${`%${normalized}%`}
         OR normalized_label = ${normalized}
         OR EXISTS (
           SELECT 1 FROM unnest(aliases) alias
           WHERE alias ILIKE ${like}
         )
       )
     ORDER BY relationship_count DESC, evidence_count DESC, label ASC
     LIMIT ${limit}
  `);
  // Defense in depth: re-assert the agent-visibility filter and the entity
  // cap in JS even though the SQL already enforces both.
  const entityRows = rowsOf<EntityRow>(entityResult)
    .filter((row) => row.source_kind === AGENT_SOURCE_KIND)
    .slice(0, MAX_ENTITY_LIMIT);

  if (entityRows.length === 0) {
    return { entities: [], relationships: [] };
  }

  const entityIds = entityRows.map((row) => row.id);
  const entityIdList = sql.join(
    entityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  const relationshipResult = await args.db.execute(sql`
    SELECT r.id, r.source_kind, r.label, r.ontology_type_slug,
           se.label AS from_label, te.label AS to_label
      FROM knowledge_graph_relationships r
      JOIN knowledge_graph_entities se ON se.id = r.source_entity_id
      JOIN knowledge_graph_entities te ON te.id = r.target_entity_id
     WHERE r.tenant_id = ${args.tenantId}
       AND r.source_kind = ${AGENT_SOURCE_KIND}
       AND r.grounding_status = 'grounded'
       AND (
         r.source_entity_id IN (${entityIdList})
         OR r.target_entity_id IN (${entityIdList})
       )
     ORDER BY r.evidence_count DESC, r.label ASC
     LIMIT ${MAX_RELATIONSHIP_LIMIT}
  `);
  const relationshipRows = rowsOf<RelationshipRow>(relationshipResult)
    .filter((row) => row.source_kind === AGENT_SOURCE_KIND)
    .slice(0, MAX_RELATIONSHIP_LIMIT);

  // Observation-ID refs only — the SELECT list deliberately omits `snippet`
  // (and every other evidence-text column).
  const observationResult = await args.db.execute(sql`
    SELECT entity_id, evidence_source_ref
      FROM knowledge_graph_evidence
     WHERE tenant_id = ${args.tenantId}
       AND source_kind = ${AGENT_SOURCE_KIND}
       AND evidence_source_kind = 'hindsight_observation'
       AND evidence_source_ref IS NOT NULL
       AND entity_id IN (${entityIdList})
     LIMIT ${MAX_OBSERVATION_REF_ROWS}
  `);
  const observationIdsByEntity = new Map<string, string[]>();
  for (const row of rowsOf<ObservationRefRow>(observationResult)) {
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

  return {
    entities: entityRows.map((row) => ({
      id: row.id,
      label: row.label,
      typeSlug: row.ontology_type_slug,
      summary: row.summary,
      aliases: row.aliases ?? [],
      relationshipCount: Number(row.relationship_count) || 0,
      evidenceCount: Number(row.evidence_count) || 0,
      observationIds: observationIdsByEntity.get(row.id) ?? [],
    })),
    relationships: relationshipRows.map((row) => ({
      id: row.id,
      label: row.label,
      typeSlug: row.ontology_type_slug,
      fromLabel: row.from_label,
      toLabel: row.to_label,
    })),
  };
}
