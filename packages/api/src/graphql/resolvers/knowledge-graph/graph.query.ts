import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { loadFilteredEntities, type EntityFilterArgs } from "./shared.js";
import {
  serializeRelationship,
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
