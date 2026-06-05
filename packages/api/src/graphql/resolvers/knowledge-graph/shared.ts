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

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_ENTITY_LIMIT;
  return Math.max(1, Math.min(MAX_ENTITY_LIMIT, Math.floor(value!)));
}
