/**
 * workflow-resume — Workflow Interpreter task-token resume Lambda
 * (THINK-219 U6).
 *
 * SDK-invoked by the resolveWorkflowApproval mutation after an operator
 * Approve/Deny on a `waiting_for_human` run. Mirrors routine-resume.ts's
 * SFN-layer idempotency, but the workflow interpreter owns its own DB-side
 * consume-once invariant here: the approval task token is CAS-consumed via
 * `consumeTaskToken` before the SendTask* call, so a double-resume is a clean
 * "already resolved" result.
 *
 * DENY is delivered as SendTaskSuccess with {approved:false} — NEVER
 * SendTaskFailure. The interpreter's ApprovalStep only Catches States.Timeout
 * (see terraform workflow-interpreter-stepfunctions/main.tf), so a
 * SendTaskFailure would escape the state machine uncaught. record_approval
 * terminalizes a deny as `canceled` and owns the operator_decision event — we
 * never write that event here.
 *
 * packages/lambda must NOT import @thinkwork/api (see job-trigger.ts). This
 * consumes only @thinkwork/database-pg and the AWS SDK.
 */

import { SendTaskSuccessCommand, SFNClient } from "@aws-sdk/client-sfn";
import { sanitizeApprovalPlanOverride } from "@thinkwork/agent-loops-core";
import { consumeTaskToken, getDb } from "@thinkwork/database-pg";
import {
  workflowRuns,
  workflowTaskTokens,
} from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";

// Same untyped-db convention as the api-side adapters and job-trigger.
type WorkflowDb = ReturnType<typeof getDb>;

// Module-scope client; warm Lambda invocations reuse the TCP pool. Tests
// `vi.mock('@aws-sdk/client-sfn', …)` to swap the constructor.
const _DEFAULT_SFN_CLIENT = new SFNClient({});

// AWS SFN error names meaning the token already resolved (a concurrent resume
// won, or the token timed out). Mapped to `already_resolved`.
const CONSUMED_ERROR_NAMES = new Set(["TaskDoesNotExist", "TaskTimedOut"]);

export interface WorkflowResumeInput {
  tenantId: string;
  workflowRunId: string;
  approved: boolean;
  note?: string | null;
  /** THINK-193 U3: approved-plan narrowing override. Shape-validated here
   * (sanitizeApprovalPlanOverride); boundary validation against the saved
   * processor configuration happens in resolveWorkflowApproval BEFORE this
   * Lambda is invoked. Ignored on deny. */
  override?: unknown;
}

export interface WorkflowResumeResult {
  ok: true;
  /** "resumed" on the first winning resume; "already_resolved" on a race. */
  status: "resumed" | "already_resolved";
  approved: boolean;
}

export interface WorkflowResumeOptions {
  db?: WorkflowDb;
  sfnClient?: SFNClient;
}

export async function resumeWorkflowApproval(
  input: WorkflowResumeInput,
  options: WorkflowResumeOptions = {},
): Promise<WorkflowResumeResult> {
  if (!input.workflowRunId) {
    throw new Error("A workflow run id is required to resume an approval.");
  }
  if (!input.tenantId) {
    throw new Error("A tenant id is required to resume a workflow approval.");
  }

  const db = options.db ?? getDb();
  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;

  // Load the run + re-assert tenant (KTD9): never resume across tenants.
  const [run] = await db
    .select({
      id: workflowRuns.id,
      tenant_id: workflowRuns.tenant_id,
      status: workflowRuns.status,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, input.workflowRunId))
    .limit(1);
  if (!run) {
    throw new Error(`Workflow run ${input.workflowRunId} was not found.`);
  }
  if (run.tenant_id !== input.tenantId) {
    throw new Error(
      `Workflow run ${input.workflowRunId} belongs to another tenant — refusing to resume across tenants.`,
    );
  }
  if (run.status !== "waiting_for_human") {
    throw new Error(
      `Workflow run ${input.workflowRunId} is not waiting for a human decision (current status: ${run.status}).`,
    );
  }

  // Find the pending approval token by PURPOSE, not step id: an approval STEP
  // stores its definition step id (THINK-215) while the policy-driven
  // human_needed park keeps the legacy 'approval' marker — both share
  // purpose='approval', and a run holds at most one pending approval.
  const [pending] = await db
    .select({
      iteration: workflowTaskTokens.iteration,
      step_id: workflowTaskTokens.step_id,
    })
    .from(workflowTaskTokens)
    .where(
      and(
        eq(workflowTaskTokens.workflow_run_id, input.workflowRunId),
        eq(workflowTaskTokens.purpose, "approval"),
        eq(workflowTaskTokens.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) {
    // No pending approval token — a prior resume already consumed it.
    return { ok: true, status: "already_resolved", approved: input.approved };
  }

  // Sanitize the override BEFORE consuming the token so a malformed
  // override errors without burning the one-shot approval token.
  const override = input.approved
    ? sanitizeApprovalPlanOverride(input.override)
    : null;

  // CAS consume so a double-resume is a clean already-resolved result.
  const consumed = await consumeTaskToken(db, {
    workflowRunId: input.workflowRunId,
    stepId: pending.step_id,
    iteration: pending.iteration,
    purpose: "approval",
  });
  if (!consumed) {
    return { ok: true, status: "already_resolved", approved: input.approved };
  }

  // Approve AND deny both resume via SendTaskSuccess (see file header). The
  // record_approval phase reads $.approval = this JSON and terminalizes.
  // An approved-plan override rides along; deny carries none.
  const output = JSON.stringify({
    approved: input.approved,
    note: input.note ?? null,
    ...(override ? { override } : {}),
  });
  try {
    await sfn.send(
      new SendTaskSuccessCommand({ taskToken: consumed.token, output }),
    );
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (CONSUMED_ERROR_NAMES.has(name)) {
      return { ok: true, status: "already_resolved", approved: input.approved };
    }
    throw err;
  }

  return { ok: true, status: "resumed", approved: input.approved };
}

// ---------------------------------------------------------------------------
// Lambda handler — invoked directly by the resolveWorkflowApproval mutation
// via the AWS SDK (no API Gateway). Input is WorkflowResumeInput.
// ---------------------------------------------------------------------------

export async function handler(
  event: WorkflowResumeInput,
): Promise<WorkflowResumeResult> {
  return resumeWorkflowApproval(event);
}
