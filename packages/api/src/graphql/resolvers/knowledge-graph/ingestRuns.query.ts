import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
} from "./auth.js";
import {
  serializeIngestRun,
  toDbEnum,
  type KnowledgeGraphArtifactManifestRow,
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
  const rows =
    (result as unknown as { rows?: KnowledgeGraphIngestRunRow[] }).rows ?? [];
  if (rows.length === 0) return [];

  const manifestsByRunId = await loadArtifactManifestsByRunId(
    ctx,
    scope.tenantId,
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    serializeIngestRun(row, {
      artifactManifests: manifestsByRunId.get(row.id) ?? [],
    }),
  );
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 25;
  return Math.max(1, Math.min(100, Math.floor(value!)));
}

async function loadArtifactManifestsByRunId(
  ctx: GraphQLContext,
  tenantId: string,
  runIds: string[],
): Promise<Map<string, KnowledgeGraphArtifactManifestRow[]>> {
  const runIdFilters = runIds.map((runId) => sql`${runId}`);
  const result = await ctx.db.execute(sql`
    SELECT
      id,
      tenant_id,
      ingest_run_id,
      manifest_kind,
      source_kind,
      source_type,
      manifest_uri,
      artifact_root_uri,
      vault_projection_root_uri,
      checksum_sha256,
      object_count,
      source_count,
      content_type,
      content_encoding,
      byte_length,
      embedding_model,
      vector_dimension,
      ontology_version,
      ontology_mechanism,
      status,
      created_at,
      updated_at
      FROM brain.artifact_manifests
     WHERE tenant_id = ${tenantId}
       AND ingest_run_id IN (${sql.join(runIdFilters, sql`, `)})
     ORDER BY created_at ASC
  `);
  const rows =
    (result as unknown as { rows?: KnowledgeGraphArtifactManifestRow[] })
      .rows ?? [];
  const manifestsByRunId = new Map<string, KnowledgeGraphArtifactManifestRow[]>();
  for (const row of rows) {
    if (!row.ingest_run_id) continue;
    const bucket = manifestsByRunId.get(row.ingest_run_id) ?? [];
    bucket.push(row);
    manifestsByRunId.set(row.ingest_run_id, bucket);
  }
  return manifestsByRunId;
}
