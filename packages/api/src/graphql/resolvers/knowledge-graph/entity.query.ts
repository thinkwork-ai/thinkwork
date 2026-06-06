import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import {
  serializeEntity,
  serializeEvidence,
  serializeRelationship,
  type KnowledgeGraphEntityRow,
  type KnowledgeGraphEvidenceRow,
  type KnowledgeGraphRelationshipRow,
} from "./mappers.js";

export async function knowledgeGraphEntity(
  _parent: unknown,
  args: { tenantId?: string | null; entityId: string },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphScope(
    ctx,
    args,
    "knowledge_graph_entity",
  );
  const entityResult = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_entities
     WHERE tenant_id = ${scope.tenantId}
       AND id = ${args.entityId}
     LIMIT 1
  `);
  const entity = ((
    entityResult as unknown as { rows?: KnowledgeGraphEntityRow[] }
  ).rows ?? [])[0];
  if (!entity) return null;
  if (
    entity.thread_id &&
    !(await assertCanReadKnowledgeGraphThread(ctx, scope, entity.thread_id))
  ) {
    return null;
  }

  const relationshipsResult = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_relationships
     WHERE tenant_id = ${scope.tenantId}
       AND source_kind = ${entity.source_kind}
       AND source_ref = ${entity.source_ref}
       AND (source_entity_id = ${entity.id} OR target_entity_id = ${entity.id})
     ORDER BY evidence_count DESC, label ASC
  `);
  const relationshipRows = ((
    relationshipsResult as unknown as { rows?: KnowledgeGraphRelationshipRow[] }
  ).rows ?? []) as KnowledgeGraphRelationshipRow[];
  const relationshipIds = relationshipRows.map((row) => row.id);
  const relationshipIdFilters = relationshipIds.map((relationshipId) => {
    return sql`${relationshipId}::uuid`;
  });
  const relationshipEvidenceFilter =
    relationshipIdFilters.length > 0
      ? sql`OR relationship_id IN (${sql.join(relationshipIdFilters, sql`, `)})`
      : sql``;

  const evidenceResult = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_evidence
     WHERE tenant_id = ${scope.tenantId}
       AND source_kind = ${entity.source_kind}
       AND source_ref = ${entity.source_ref}
       AND (
         entity_id = ${entity.id}
         ${relationshipEvidenceFilter}
       )
     ORDER BY COALESCE(message_created_at, observed_at, created_at) DESC, created_at DESC
  `);
  const evidenceRows = ((
    evidenceResult as unknown as { rows?: KnowledgeGraphEvidenceRow[] }
  ).rows ?? []) as KnowledgeGraphEvidenceRow[];
  const evidence = evidenceRows.map(serializeEvidence);
  const evidenceByRelationshipId = new Map<string, unknown[]>();
  for (const row of evidence) {
    if (!row.relationshipId) continue;
    const existing = evidenceByRelationshipId.get(row.relationshipId) ?? [];
    existing.push(row);
    evidenceByRelationshipId.set(row.relationshipId, existing);
  }

  return serializeEntity(entity, {
    relationships: relationshipRows.map((relationship) =>
      serializeRelationship(relationship, {
        evidence: evidenceByRelationshipId.get(relationship.id) ?? [],
      }),
    ),
    evidence: evidence.filter((row) => row.entityId === entity.id),
  });
}
