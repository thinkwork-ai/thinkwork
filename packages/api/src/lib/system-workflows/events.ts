import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  systemWorkflowRuns,
  systemWorkflowStepEvents,
} from "@thinkwork/database-pg/schema";

export type SystemWorkflowTerminalStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type SystemWorkflowRunStatus =
  | "running"
  | "awaiting_approval"
  | SystemWorkflowTerminalStatus;

export type RecordSystemWorkflowStepEventInput = {
  tenantId: string;
  runId: string;
  nodeId: string;
  stepType: string;
  status: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  inputJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;
  costUsdCents?: number | null;
  retryCount?: number;
  idempotencyKey?: string | null;
};

export type RecordSystemWorkflowStepEventResult = {
  event: typeof systemWorkflowStepEvents.$inferSelect;
  inserted: boolean;
  deduped: boolean;
};

const TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);
const TERMINAL_STATUSES_SQL_LIST = sql.raw(
  TERMINAL_STATUSES.map((status) => `'${status}'`).join(","),
);

export async function recordSystemWorkflowStepEvent(
  input: RecordSystemWorkflowStepEventInput,
  db = getDb(),
): Promise<RecordSystemWorkflowStepEventResult> {
  const values = {
    tenant_id: input.tenantId,
    run_id: input.runId,
    node_id: input.nodeId,
    step_type: input.stepType,
    status: input.status,
    started_at: input.startedAt ?? null,
    finished_at: input.finishedAt ?? null,
    input_json: input.inputJson ?? null,
    output_json: input.outputJson ?? null,
    error_json: input.errorJson ?? null,
    cost_usd_cents: input.costUsdCents ?? null,
    retry_count: input.retryCount ?? 0,
    idempotency_key: input.idempotencyKey ?? null,
  };

  const inserted = await db
    .insert(systemWorkflowStepEvents)
    .values(values)
    .onConflictDoNothing()
    .returning();

  if (inserted[0])
    return { event: inserted[0], inserted: true, deduped: false };

  if (!input.idempotencyKey) {
    throw new Error(
      "System Workflow step insert skipped without an idempotency key",
    );
  }

  const existing = await db
    .select()
    .from(systemWorkflowStepEvents)
    .where(
      and(
        eq(systemWorkflowStepEvents.run_id, input.runId),
        eq(systemWorkflowStepEvents.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `System Workflow step dedupe key ${input.idempotencyKey} conflicted but no row was found`,
    );
  }

  console.warn(
    `[system-workflows] deduped step event run=${input.runId} node=${input.nodeId} key=${input.idempotencyKey}`,
  );
  return { event: existing[0], inserted: false, deduped: true };
}

export type UpdateSystemWorkflowRunInput = {
  executionArn: string;
  status: SystemWorkflowRunStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  outputJson?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  totalCostUsdCents?: number | null;
};

export type UpdateSystemWorkflowRunResult = {
  updated: boolean;
  reason?: "not_found" | "idempotent";
};

export async function updateSystemWorkflowRunFromExecution(
  input: UpdateSystemWorkflowRunInput,
  db = getDb(),
): Promise<UpdateSystemWorkflowRunResult> {
  const setClause: Record<string, unknown> = {
    status: input.status,
  };
  if (input.startedAt !== undefined) setClause.started_at = input.startedAt;
  if (input.finishedAt !== undefined) setClause.finished_at = input.finishedAt;
  if (input.outputJson !== undefined) setClause.output_json = input.outputJson;
  if (input.errorCode !== undefined) setClause.error_code = input.errorCode;
  if (input.errorMessage !== undefined)
    setClause.error_message = input.errorMessage;
  if (input.totalCostUsdCents !== undefined) {
    setClause.total_cost_usd_cents = input.totalCostUsdCents;
  }

  const updated = await db
    .update(systemWorkflowRuns)
    .set(setClause)
    .where(
      and(
        eq(systemWorkflowRuns.sfn_execution_arn, input.executionArn),
        sql`(${systemWorkflowRuns.status} NOT IN (${TERMINAL_STATUSES_SQL_LIST})
              OR ${systemWorkflowRuns.status} = ${input.status})`,
      ),
    )
    .returning({ id: systemWorkflowRuns.id });

  if (updated.length > 0) return { updated: true };

  const existing = await db
    .select({ id: systemWorkflowRuns.id, status: systemWorkflowRuns.status })
    .from(systemWorkflowRuns)
    .where(eq(systemWorkflowRuns.sfn_execution_arn, input.executionArn));

  if (existing.length === 0) return { updated: false, reason: "not_found" };

  if (TERMINAL_STATUS_SET.has(existing[0].status)) {
    console.warn(
      `[system-workflows] lifecycle no-op arn=${input.executionArn} already terminal status=${existing[0].status}, incoming=${input.status}`,
    );
    return { updated: true, reason: "idempotent" };
  }

  return { updated: false, reason: "not_found" };
}

export async function findSystemWorkflowRunByExecutionArn(
  executionArn: string,
  db = getDb(),
): Promise<typeof systemWorkflowRuns.$inferSelect | null> {
  const rows = await db
    .select()
    .from(systemWorkflowRuns)
    .where(eq(systemWorkflowRuns.sfn_execution_arn, executionArn))
    .limit(1);
  return rows[0] ?? null;
}
