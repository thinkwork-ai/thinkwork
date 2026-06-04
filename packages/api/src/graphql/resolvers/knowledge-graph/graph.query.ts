import { sql } from "drizzle-orm";
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

  const result = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_relationships
     WHERE tenant_id = ${entities[0].tenantId}
       AND thread_id = ${args.threadId}
       AND source_entity_id = ANY(${Array.from(entityIds)}::uuid[])
       AND target_entity_id = ANY(${Array.from(entityIds)}::uuid[])
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
