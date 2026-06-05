import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  loadFilteredEntities,
  shouldUseCanonicalTenantView,
  type EntityFilterArgs,
} from "./shared.js";
import {
  serializeRelationship,
  toDbEnum,
  toGraphqlEnum,
  type KnowledgeGraphRelationshipRow,
} from "./mappers.js";

export async function knowledgeGraphGraph(
  _parent: unknown,
  args: EntityFilterArgs,
  ctx: GraphQLContext,
) {
  const entities = await loadFilteredEntities(
    ctx,
    args,
    "knowledge_graph_graph",
    { limit: 500 },
  );
  const entityIds = new Set(entities.map((entity) => entity.id));
  if (entityIds.size === 0) {
    return { nodes: [], edges: [] };
  }

  if (shouldUseCanonicalTenantView(args)) {
    return loadCanonicalTenantGraph(ctx, args, entities);
  }

  const entityIdFilters = Array.from(entityIds).map((entityId) => {
    return sql`${entityId}::uuid`;
  });

  const conditions: SQL[] = [
    sql`tenant_id = ${entities[0].tenantId}`,
    sql`ontology_relationship_type_id IS NOT NULL`,
    sql`ontology_type_slug IS NOT NULL`,
    sql`grounding_status = 'grounded'`,
    sql`source_entity_id IN (${sql.join(entityIdFilters, sql`, `)})`,
    sql`target_entity_id IN (${sql.join(entityIdFilters, sql`, `)})`,
  ];
  if (args.threadId) {
    conditions.push(sql`thread_id = ${args.threadId}`);
  }
  const sourceKind = toDbEnum(args.sourceKind);
  if (sourceKind) {
    conditions.push(sql`source_kind = ${sourceKind}`);
  }
  if (args.sourceRef) {
    conditions.push(sql`source_ref = ${args.sourceRef}`);
  }
  if (args.runId) {
    conditions.push(sql`ingest_run_id = ${args.runId}`);
  }

  const result = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_relationships
     WHERE ${sql.join(conditions, sql` AND `)}
     ORDER BY evidence_count DESC, label ASC
  `);
  const rows = ((
    result as unknown as { rows?: KnowledgeGraphRelationshipRow[] }
  ).rows ?? []) as KnowledgeGraphRelationshipRow[];

  return {
    nodes: entities.map((entity) => ({
      id: entity.id,
      entityId: entity.id,
      label: entity.label,
      typeLabel: entity.typeLabel,
      ontologyTypeSlug: entity.ontologyTypeSlug,
      groundingStatus: entity.groundingStatus,
      provenanceStatus: entity.provenanceStatus,
      relationshipCount: entity.relationshipCount,
      evidenceCount: entity.evidenceCount,
    })),
    edges: rows.map((row) => {
      const relationship = serializeRelationship(row);
      return {
        id: relationship.id,
        relationshipId: relationship.id,
        source: row.source_entity_id,
        target: row.target_entity_id,
        label: relationship.label,
        ontologyTypeSlug: relationship.ontologyTypeSlug,
        groundingStatus: toGraphqlEnum(row.grounding_status),
        provenanceStatus: toGraphqlEnum(row.provenance_status),
        evidenceCount: relationship.evidenceCount,
      };
    }),
  };
}

async function loadCanonicalTenantGraph(
  ctx: GraphQLContext,
  args: EntityFilterArgs,
  entities: Awaited<ReturnType<typeof loadFilteredEntities>>,
) {
  const conditions: SQL[] = [
    sql`tenant_id = ${entities[0].tenantId}`,
    sql`ontology_entity_type_id IS NOT NULL`,
    sql`ontology_type_slug IS NOT NULL`,
    sql`grounding_status = 'grounded'`,
  ];
  const search = args.search?.trim();
  if (search) {
    conditions.push(sql`(
      label ILIKE ${`%${search}%`}
      OR normalized_label ILIKE ${`%${search.toLowerCase()}%`}
      OR EXISTS (
        SELECT 1 FROM unnest(aliases) alias
        WHERE alias ILIKE ${`%${search}%`}
      )
    )`);
  }
  if (args.ontologyType) {
    conditions.push(sql`ontology_type_slug = ${args.ontologyType}`);
  }
  const grounding = toDbEnum(args.groundingStatus);
  if (grounding) {
    conditions.push(sql`grounding_status = ${grounding}`);
  }
  const provenance = toDbEnum(args.provenanceStatus);
  if (provenance) {
    conditions.push(sql`provenance_status = ${provenance}`);
  }

  const result = await ctx.db.execute(sql`
    WITH filtered_entities AS (
      SELECT *
        FROM knowledge_graph_entities
       WHERE ${sql.join(conditions, sql` AND `)}
    ),
    canonical_entities AS (
      SELECT
        (array_agg(id ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS id,
        normalized_label,
        ontology_type_slug
      FROM filtered_entities
      GROUP BY normalized_label, ontology_type_slug
    ),
    relationship_edges AS (
      SELECT
        r.*,
        source_canonical.id AS canonical_source_entity_id,
        target_canonical.id AS canonical_target_entity_id
      FROM knowledge_graph_relationships r
      JOIN filtered_entities source_entity
        ON source_entity.id = r.source_entity_id
      JOIN filtered_entities target_entity
        ON target_entity.id = r.target_entity_id
      JOIN canonical_entities source_canonical
        ON source_canonical.normalized_label = source_entity.normalized_label
       AND source_canonical.ontology_type_slug = source_entity.ontology_type_slug
      JOIN canonical_entities target_canonical
        ON target_canonical.normalized_label = target_entity.normalized_label
       AND target_canonical.ontology_type_slug = target_entity.ontology_type_slug
      WHERE r.tenant_id = ${entities[0].tenantId}
        AND r.ontology_relationship_type_id IS NOT NULL
        AND r.ontology_type_slug IS NOT NULL
        AND r.grounding_status = 'grounded'
    )
    SELECT
      (array_agg(id ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS id,
      tenant_id,
      NULL::uuid AS thread_id,
      (array_agg(source_kind ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS source_kind,
      (array_agg(source_ref ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS source_ref,
      (array_agg(ingest_run_id ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS ingest_run_id,
      (array_agg(cognee_edge_id ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS cognee_edge_id,
      canonical_source_entity_id AS source_entity_id,
      canonical_target_entity_id AS target_entity_id,
      (array_agg(label ORDER BY evidence_count DESC, updated_at DESC, label ASC))[1] AS label,
      ontology_relationship_type_id,
      ontology_type_slug,
      'grounded'::text AS grounding_status,
      CASE
        WHEN bool_or(provenance_status = 'strong') THEN 'strong'
        ELSE 'weak'
      END AS provenance_status,
      max(confidence) AS confidence,
      jsonb_build_object(
        'canonicalRelationship', true,
        'sourceRelationshipCount', count(*),
        'sourceKinds', array_agg(DISTINCT source_kind ORDER BY source_kind)
      ) AS properties,
      jsonb_build_object('canonicalRelationship', true) AS diagnostics,
      sum(evidence_count)::integer AS evidence_count,
      max(last_seen_at) AS last_seen_at,
      min(created_at) AS created_at,
      max(updated_at) AS updated_at
    FROM relationship_edges
    GROUP BY
      tenant_id,
      canonical_source_entity_id,
      canonical_target_entity_id,
      ontology_relationship_type_id,
      ontology_type_slug
    ORDER BY evidence_count DESC, label ASC
  `);
  const relationshipRows = ((
    result as unknown as { rows?: KnowledgeGraphRelationshipRow[] }
  ).rows ?? []) as KnowledgeGraphRelationshipRow[];
  const visibleIds = new Set(entities.map((entity) => entity.id));
  const rows = relationshipRows.filter(
    (row) =>
      visibleIds.has(row.source_entity_id) &&
      visibleIds.has(row.target_entity_id),
  );

  return {
    nodes: entities.map((entity) => ({
      id: entity.id,
      entityId: entity.id,
      label: entity.label,
      typeLabel: entity.typeLabel,
      ontologyTypeSlug: entity.ontologyTypeSlug,
      groundingStatus: entity.groundingStatus,
      provenanceStatus: entity.provenanceStatus,
      relationshipCount: entity.relationshipCount,
      evidenceCount: entity.evidenceCount,
    })),
    edges: rows.map((row) => {
      const relationship = serializeRelationship(row);
      return {
        id: relationship.id,
        relationshipId: relationship.id,
        source: row.source_entity_id,
        target: row.target_entity_id,
        label: relationship.label,
        ontologyTypeSlug: relationship.ontologyTypeSlug,
        groundingStatus: toGraphqlEnum(row.grounding_status),
        provenanceStatus: toGraphqlEnum(row.provenance_status),
        evidenceCount: relationship.evidenceCount,
      };
    }),
  };
}
