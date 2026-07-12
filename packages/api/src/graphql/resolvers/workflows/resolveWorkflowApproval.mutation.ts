/**
 * resolveWorkflowApproval — operator Approve/Deny of a workflow run that is
 * parked on a human-approval step (THINK-219 U7).
 *
 * A `waiting_for_human` run holds a Step Functions task token. This mutation
 * hands the decision to the workflow-resume Lambda, which SendTaskSuccess /
 * SendTaskFailure-resumes the interpreter; record_approval then writes the
 * operator_decision event with safe scalars. The `note` travels in the Lambda
 * payload only — this resolver writes NO events.
 *
 * Wire: RequestResponse invoke so the operator gets accept/reject feedback and
 * Lambda errors surface directly (never fire-and-forget — hard rule). The
 * function name follows the established `thinkwork-${STAGE}-api-workflow-resume`
 * convention; graphql-http's env block is at the 4 KB ceiling, so we build the
 * name from STAGE at runtime rather than carrying an env var.
 */
import { eq } from "drizzle-orm";
import { workflowRuns } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { assertCanReadWorkflowTenant } from "./types.js";
import {
  assertOverrideNarrowsSavedConfig,
  overrideInputToProtocol,
  type WorkflowApprovalOverrideInput,
} from "./approval-override.js";

type ResolveWorkflowApprovalArgs = {
  runId: string;
  approve: boolean;
  note?: string | null;
  /** THINK-193 U3: approved-plan narrowing override (memory workflows). */
  override?: WorkflowApprovalOverrideInput | null;
};

export async function resolveWorkflowApproval(
  _parent: unknown,
  args: ResolveWorkflowApprovalArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, args.runId))
    .limit(1);
  if (!run) {
    throw new Error(`Workflow run ${args.runId} not found`);
  }

  // Tenant authorization first — before touching the run or any Lambda.
  await assertCanReadWorkflowTenant(ctx, run.tenant_id);

  if (run.status !== "waiting_for_human") {
    throw new Error(
      `Workflow run ${args.runId} is not awaiting approval (status: ${run.status})`,
    );
  }

  // Approved-plan override (THINK-193 U3): shape-sanitize, then validate it
  // only NARROWS the saved processor configuration — BEFORE any Lambda
  // invoke, so a widening attempt errors without consuming the token.
  const override = args.approve ? overrideInputToProtocol(args.override) : null;
  if (override) {
    await assertOverrideNarrowsSavedConfig(db, {
      tenantId: run.tenant_id,
      workflowId: run.workflow_id,
      override,
    });
  }

  const stage = process.env.STAGE;
  if (!stage) {
    throw new Error(
      "Cannot resolve workflow approval: STAGE env var is required on graphql-http.",
    );
  }
  const functionName = `thinkwork-${stage}-api-workflow-resume`;

  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          tenantId: run.tenant_id,
          workflowRunId: run.id,
          approved: args.approve,
          note: args.note ?? null,
          override,
        }),
      ),
    }),
  );

  if (res.FunctionError) {
    const detail = res.Payload
      ? new TextDecoder().decode(res.Payload).slice(0, 500)
      : res.FunctionError;
    throw new Error(`workflow-resume Lambda error: ${detail}`);
  }

  const [updated] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, args.runId))
    .limit(1);
  return snakeToCamel(updated ?? run);
}
