/**
 * Workflow interpreter execution-callback Lambda (THINK-219 U5).
 *
 * EventBridge routes Step Functions execution status-change events here. This
 * projects the terminal status onto the workflow run — guarded in
 * updateInterpreterRunFromExecution so a superseded (rolled-over) execution's
 * SUCCEEDED can never terminalize a live run. A failure/timeout also lands a
 * workflow_step_failed event so the run's timeline carries the reason (AE2).
 *
 * packages/lambda must NOT import @thinkwork/api — this consumes only
 * @thinkwork/database-pg and the AWS SDK.
 */

import {
  getDb,
  recordWorkflowStepEvent,
  updateInterpreterRunFromExecution,
} from "@thinkwork/database-pg";
import { workflowRuns } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";

type WorkflowDb = ReturnType<typeof getDb>;

export interface SfnStatusChangeEvent {
  detail: {
    executionArn: string;
    status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED" | "RUNNING";
    cause?: string;
    error?: string;
  };
}

const SFN_TO_RUN_STATUS: Record<
  string,
  "failed" | "timed_out" | "canceled" | null
> = {
  // SUCCEEDED is deliberately a no-op: every success path (terminal_success,
  // terminal_canceled, rollover) writes its terminal DB status inside
  // record_advance/record_approval BEFORE the execution ends. Projecting
  // SUCCEEDED here would race the rollover repoint — the old execution's
  // SUCCEEDED event can arrive before the new execution's load_next repoints
  // backend_execution_id, and the ARN guard alone would wrongly terminalize a
  // live looping run.
  SUCCEEDED: null,
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  ABORTED: "canceled",
  RUNNING: null,
};

export async function handleExecutionCallback(
  db: WorkflowDb,
  event: SfnStatusChangeEvent,
  now: Date = new Date(),
): Promise<{ handled: boolean; runId?: string; reason?: string }> {
  const detail = event.detail;
  const mapped = SFN_TO_RUN_STATUS[detail.status];

  // RUNNING (and any unmapped status) is a no-op — nothing terminal to project.
  if (!mapped) {
    return { handled: false, reason: "non_terminal_status" };
  }

  const errorSummary =
    mapped === "failed" || mapped === "timed_out" || mapped === "canceled"
      ? buildErrorSummary(detail)
      : null;

  // Select the run for the reported ARN BEFORE the update so we have the
  // tenant for the follow-on step event. The update itself is guarded against
  // superseded ARNs and already-terminal runs.
  const [existing] = await db
    .select({ id: workflowRuns.id, tenant_id: workflowRuns.tenant_id })
    .from(workflowRuns)
    .where(eq(workflowRuns.backend_execution_id, detail.executionArn))
    .limit(1);

  const updated = await updateInterpreterRunFromExecution(db, {
    executionArn: detail.executionArn,
    status: mapped,
    errorSummary,
    now,
  });

  // Null return = superseded rollover ARN or an already-terminal run. Log and
  // exit 200 — never throw.
  if (!updated) {
    return { handled: false, reason: "superseded_or_already_terminal" };
  }

  if (
    (mapped === "failed" || mapped === "timed_out") &&
    existing &&
    errorSummary
  ) {
    await recordWorkflowStepEvent(db, {
      tenantId: existing.tenant_id,
      workflowRunId: updated.runId,
      eventType: "workflow_step_failed",
      summary: {
        status: mapped,
        errorSummary,
        reason: "execution_terminated",
      },
      now,
    });
  }

  return { handled: true, runId: updated.runId };
}

function buildErrorSummary(detail: SfnStatusChangeEvent["detail"]): string {
  const status = detail.status.toLowerCase();
  const message = detail.error || detail.cause;
  const base = `Workflow execution ${status}`;
  return message ? `${base}: ${message}`.slice(0, 1000) : base;
}

export async function handler(
  event: SfnStatusChangeEvent,
): Promise<{ handled: boolean; runId?: string; reason?: string }> {
  const db = getDb();
  const result = await handleExecutionCallback(db, event);
  if (!result.handled) {
    console.log(
      `[workflow-execution-callback] no-op for ${event.detail?.executionArn ?? "unknown"} (${event.detail?.status}): ${result.reason}`,
    );
  }
  return result;
}
