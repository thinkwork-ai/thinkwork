import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  resolveKnowledgeGraphScope,
  threadVisibilityWhereSql,
} from "./auth.js";
import {
  serializeIngestRun,
  type KnowledgeGraphIngestRunRow,
} from "./mappers.js";

interface ThreadCandidateRow {
  thread_id: string;
  tenant_id: string;
  title: string;
  number: number;
  requester_user_id: string | null;
  requester_name: string | null;
  space_id: string | null;
  space_name: string | null;
  message_count: number;
  last_message_at: Date | string | null;
  run_id: string | null;
  run_tenant_id: string | null;
  run_thread_id: string | null;
  source_kind: string | null;
  source_ref: string | null;
  source_label: string | null;
  requested_by_user_id: string | null;
  status: string | null;
  trigger: string | null;
  cognee_dataset_name: string | null;
  cognee_dataset_id: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  duration_ms: number | null;
  error: string | null;
  entity_count: number | null;
  relationship_count: number | null;
  evidence_count: number | null;
  diagnostic_count: number | null;
  run_message_count: number | null;
  input: unknown;
  metrics: unknown;
  metadata: unknown;
  run_created_at: Date | string | null;
  run_updated_at: Date | string | null;
}

export async function knowledgeGraphThreadCandidates(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    requesterUserId?: string | null;
    query?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphScope(
    ctx,
    args,
    "knowledge_graph_thread_candidates",
  );
  const visibility = await threadVisibilityWhereSql(scope);
  const limit = clampLimit(args.limit);
  const requesterFilter = args.requesterUserId
    ? sql`AND t.user_id = ${args.requesterUserId}`
    : sql``;
  const query = args.query?.trim();
  const queryFilter = query
    ? sql`AND (
        t.title ILIKE ${`%${query}%`}
        OR t.identifier ILIKE ${`%${query}%`}
        OR CAST(t.number AS text) = ${query}
      )`
    : sql``;

  const result = await ctx.db.execute(sql`
    WITH latest_run AS (
      SELECT DISTINCT ON (thread_id) *
        FROM knowledge_graph_ingest_runs
       WHERE tenant_id = ${scope.tenantId}
         AND source_kind = 'thread'
       ORDER BY thread_id, created_at DESC
    )
    SELECT
      t.id AS thread_id,
      t.tenant_id,
      t.title,
      t.number,
      t.user_id AS requester_user_id,
      COALESCE(up.display_name, u.name, u.email) AS requester_name,
      t.space_id,
      s.name AS space_name,
      COUNT(m.id)::int AS message_count,
      MAX(m.created_at) AS last_message_at,
      lr.id AS run_id,
      lr.tenant_id AS run_tenant_id,
      lr.thread_id AS run_thread_id,
      lr.source_kind,
      lr.source_ref,
      lr.source_label,
      lr.requested_by_user_id,
      lr.status,
      lr.trigger,
      lr.cognee_dataset_name,
      lr.cognee_dataset_id,
      lr.started_at,
      lr.finished_at,
      lr.duration_ms,
      lr.error,
      lr.entity_count,
      lr.relationship_count,
      lr.evidence_count,
      lr.diagnostic_count,
      lr.message_count AS run_message_count,
      lr.input,
      lr.metrics,
      lr.metadata,
      lr.created_at AS run_created_at,
      lr.updated_at AS run_updated_at
    FROM threads t
    LEFT JOIN messages m
      ON m.tenant_id = t.tenant_id
     AND m.thread_id = t.id
    LEFT JOIN users u
      ON u.id = t.user_id
     AND u.tenant_id = t.tenant_id
    LEFT JOIN user_profiles up
      ON up.user_id = u.id
     AND up.tenant_id = t.tenant_id
    LEFT JOIN spaces s
      ON s.id = t.space_id
     AND s.tenant_id = t.tenant_id
    LEFT JOIN latest_run lr
      ON lr.thread_id = t.id
    WHERE t.tenant_id = ${scope.tenantId}
      AND ${visibility}
      ${requesterFilter}
      ${queryFilter}
    GROUP BY
      t.id,
      u.id,
      up.display_name,
      s.id,
      lr.id,
      lr.tenant_id,
      lr.thread_id,
      lr.source_kind,
      lr.source_ref,
      lr.source_label,
      lr.requested_by_user_id,
      lr.status,
      lr.trigger,
      lr.cognee_dataset_name,
      lr.cognee_dataset_id,
      lr.started_at,
      lr.finished_at,
      lr.duration_ms,
      lr.error,
      lr.entity_count,
      lr.relationship_count,
      lr.evidence_count,
      lr.diagnostic_count,
      lr.message_count,
      lr.input,
      lr.metrics,
      lr.metadata,
      lr.created_at,
      lr.updated_at
    HAVING COUNT(m.id) > 0
    ORDER BY MAX(m.created_at) DESC NULLS LAST, t.updated_at DESC
    LIMIT ${limit}
  `);

  return (
    ((result as unknown as { rows?: ThreadCandidateRow[] }).rows ??
      []) as ThreadCandidateRow[]
  ).map((row) => ({
    threadId: row.thread_id,
    tenantId: row.tenant_id,
    title: row.title,
    number: Number(row.number),
    requesterUserId: row.requester_user_id,
    requesterName: row.requester_name,
    spaceId: row.space_id,
    spaceName: row.space_name,
    messageCount: Number(row.message_count) || 0,
    lastMessageAt: toIso(row.last_message_at),
    lastIngestRun: row.run_id
      ? serializeIngestRun({
          id: row.run_id,
          tenant_id: row.run_tenant_id!,
          thread_id: row.run_thread_id!,
          source_kind: row.source_kind!,
          source_ref: row.source_ref!,
          source_label: row.source_label,
          requested_by_user_id: row.requested_by_user_id,
          status: row.status!,
          trigger: row.trigger!,
          cognee_dataset_name: row.cognee_dataset_name!,
          cognee_dataset_id: row.cognee_dataset_id,
          started_at: row.started_at,
          finished_at: row.finished_at,
          duration_ms: row.duration_ms,
          error: row.error,
          entity_count: row.entity_count ?? 0,
          relationship_count: row.relationship_count ?? 0,
          evidence_count: row.evidence_count ?? 0,
          diagnostic_count: row.diagnostic_count ?? 0,
          message_count: row.run_message_count ?? 0,
          input: row.input,
          metrics: row.metrics,
          metadata: row.metadata,
          created_at: row.run_created_at,
          updated_at: row.run_updated_at,
        } as KnowledgeGraphIngestRunRow)
      : null,
  }));
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 25;
  return Math.max(1, Math.min(100, Math.floor(value!)));
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}
