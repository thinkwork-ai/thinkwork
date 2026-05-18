import { and, desc, eq } from "drizzle-orm";
import { threadIdleLearningRuns } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { readIdleLearningReport } from "../../../lib/requester-memory/storage.js";
import {
  loadRequesterIdleLearningRun,
  parseChangedFiles,
  type ThreadIdleLearningRunRow,
} from "../../../lib/requester-memory/rollback.js";

const MAX_LIMIT = 100;

export async function threadIdleLearningRunsQuery(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    threadId?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireMemoryUserScope(ctx, {
    ...args,
    allowTenantAdmin: true,
  });
  const limit = clampLimit(args.limit);
  const conditions = [
    eq(threadIdleLearningRuns.tenant_id, tenantId),
    eq(threadIdleLearningRuns.requester_user_id, userId),
  ];
  if (args.threadId) {
    conditions.push(eq(threadIdleLearningRuns.thread_id, args.threadId));
  }

  const rows = await ctx.db
    .select()
    .from(threadIdleLearningRuns)
    .where(and(...conditions))
    .orderBy(desc(threadIdleLearningRuns.created_at))
    .limit(limit);

  return rows.map((row) =>
    serializeThreadIdleLearningRun(row as ThreadIdleLearningRunRow),
  );
}

export async function threadIdleLearningRunQuery(
  _parent: unknown,
  args: { tenantId?: string | null; userId?: string | null; runId: string },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireMemoryUserScope(ctx, {
    ...args,
    allowTenantAdmin: true,
  });
  const run = await loadRequesterIdleLearningRun({
    tenantId,
    userId,
    runId: args.runId,
  });
  if (!run) return null;
  return serializeThreadIdleLearningRun(run, {
    reportMarkdown: await readIdleLearningReport({
      tenantId,
      userId,
      runId: run.id,
    }),
  });
}

export function serializeThreadIdleLearningRun(
  row: ThreadIdleLearningRunRow,
  extra: { reportMarkdown?: string | null } = {},
) {
  const changedFiles = parseChangedFiles(row.changed_files);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    computerId: row.computer_id,
    requesterUserId: row.requester_user_id,
    scheduledJobId: row.scheduled_job_id,
    activitySequence: row.activity_sequence,
    scheduledFor: toIso(row.scheduled_for),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    status: row.status,
    changedFiles,
    candidateSummary: jsonScalar(row.candidate_summary),
    reportS3Key: row.report_s3_key,
    reportMarkdown: extra.reportMarkdown ?? null,
    error: row.error,
    budget: jsonScalar(row.budget),
    metadata: jsonScalar(row.metadata),
    canRollback: row.status === "changed" && changedFiles.length > 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 25;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value!)));
}

function jsonScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}
