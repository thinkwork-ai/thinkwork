import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import {
  serializeIngestRun,
  toDbEnum,
  type KnowledgeGraphIngestRunRow,
} from "./mappers.js";

export async function knowledgeGraphIngestRuns(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    threadId?: string | null;
    sourceKind?: string | null;
    sourceRef?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphScope(
    ctx,
    args,
    "knowledge_graph_ingest_runs",
  );
  if (
    args.threadId &&
    !(await assertCanReadKnowledgeGraphThread(ctx, scope, args.threadId))
  ) {
    return [];
  }

  const limit = clampLimit(args.limit);
  const threadFilter = args.threadId
    ? sql`AND thread_id = ${args.threadId}`
    : sql``;
  const sourceKind = toDbEnum(args.sourceKind);
  const sourceKindFilter = sourceKind
    ? sql`AND source_kind = ${sourceKind}`
    : sql``;
  const sourceRefFilter = args.sourceRef
    ? sql`AND source_ref = ${args.sourceRef}`
    : sql``;
  const result = await ctx.db.execute(sql`
    SELECT *
      FROM knowledge_graph_ingest_runs
     WHERE tenant_id = ${scope.tenantId}
       ${threadFilter}
       ${sourceKindFilter}
       ${sourceRefFilter}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `);

  return (
    (result as unknown as { rows?: KnowledgeGraphIngestRunRow[] }).rows ?? []
  ).map(serializeIngestRun);
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 25;
  return Math.max(1, Math.min(100, Math.floor(value!)));
}
