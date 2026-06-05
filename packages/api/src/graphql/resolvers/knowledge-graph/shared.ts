import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import {
  serializeEntity,
  toDbEnum,
  type KnowledgeGraphEntityRow,
} from "./mappers.js";

const DEFAULT_ENTITY_LIMIT = 100;
const MAX_ENTITY_LIMIT = 500;

export interface EntityFilterArgs {
  tenantId?: string | null;
  threadId?: string | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  runId?: string | null;
  search?: string | null;
  ontologyType?: string | null;
  groundingStatus?: string | null;
  provenanceStatus?: string | null;
  limit?: number | null;
}

export async function loadFilteredEntities(
  ctx: GraphQLContext,
  args: EntityFilterArgs,
  operationName: string,
  options: { limit?: number | null } = {},
) {
  const scope = await resolveKnowledgeGraphScope(ctx, args, operationName);
  if (
    args.threadId &&
    !(await assertCanReadKnowledgeGraphThread(ctx, scope, args.threadId))
  ) {
    return [];
  }

  const conditions: SQL[] = [
    sql`tenant_id = ${scope.tenantId}`,
    sql`ontology_entity_type_id IS NOT NULL`,
    sql`ontology_type_slug IS NOT NULL`,
    sql`grounding_status = 'grounded'`,
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
  const search = normalizeSearch(args.search);
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

  const limit = clampLimit(options.limit ?? args.limit);
  if (shouldUseCanonicalTenantView(args)) {
    const result = await ctx.db.execute(sql`
      WITH filtered_entities AS (
        SELECT *
          FROM knowledge_graph_entities
         WHERE ${sql.join(conditions, sql` AND `)}
      )
      SELECT
        (array_agg(id ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS id,
        tenant_id,
        NULL::uuid AS thread_id,
        (array_agg(source_kind ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS source_kind,
        (array_agg(source_ref ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS source_ref,
        (array_agg(ingest_run_id ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS ingest_run_id,
        (array_agg(cognee_node_id ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS cognee_node_id,
        (array_agg(label ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS label,
        normalized_label,
        (array_agg(type_label ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS type_label,
        ontology_entity_type_id,
        ontology_type_slug,
        'grounded'::text AS grounding_status,
        CASE
          WHEN bool_or(provenance_status = 'strong') THEN 'strong'
          ELSE 'weak'
        END AS provenance_status,
        (array_agg(summary ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS summary,
        (array_agg(aliases ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS aliases,
        (array_agg(properties ORDER BY relationship_count DESC, evidence_count DESC, updated_at DESC, label ASC))[1] AS properties,
        jsonb_build_object(
          'canonicalEntity', true,
          'sourceEntityCount', count(*),
          'sourceKinds', array_agg(DISTINCT source_kind ORDER BY source_kind)
        ) AS diagnostics,
        sum(relationship_count)::integer AS relationship_count,
        sum(evidence_count)::integer AS evidence_count,
        max(last_seen_at) AS last_seen_at,
        min(created_at) AS created_at,
        max(updated_at) AS updated_at
      FROM filtered_entities
      GROUP BY tenant_id, normalized_label, ontology_entity_type_id, ontology_type_slug
      ORDER BY relationship_count DESC, evidence_count DESC, label ASC
      LIMIT ${limit}
    `);
    return (
      (result as unknown as { rows?: KnowledgeGraphEntityRow[] }).rows ?? []
    ).map((row) => serializeEntity(row));
  }

  const result = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_entities
     WHERE ${sql.join(conditions, sql` AND `)}
     ORDER BY relationship_count DESC, evidence_count DESC, label ASC
     LIMIT ${limit}
  `);
  return (
    (result as unknown as { rows?: KnowledgeGraphEntityRow[] }).rows ?? []
  ).map((row) => serializeEntity(row));
}

function normalizeSearch(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function shouldUseCanonicalTenantView(args: EntityFilterArgs): boolean {
  return !args.threadId && !args.sourceKind && !args.sourceRef && !args.runId;
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_ENTITY_LIMIT;
  return Math.max(1, Math.min(MAX_ENTITY_LIMIT, Math.floor(value!)));
}
