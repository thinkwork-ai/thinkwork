/**
 * runScheduledJob — fire a scheduled job synchronously, on demand.
 *
 * Operator value: test a schedule's payload without waiting for the
 * next EventBridge firing. Common during development, post-deploy
 * sanity, and incident response.
 *
 * Wire: invoke the job-trigger Lambda directly with the same payload
 * shape AWS Scheduler would have sent (see `JobTriggerEvent` in
 * `packages/lambda/job-trigger.ts`). The Lambda is invoked with
 * `InvocationType: "RequestResponse"` so the operator gets accept/
 * reject feedback; downstream effects (thread turn enqueue, routine
 * Step Functions start) remain async.
 *
 * Auth: `requireAdminOrServiceCaller`. Manual job-firing is admin-tier
 * (it can spend AWS money and write user-visible threads), but does
 * not stamp a specific user identity on the row — the trigger Lambda
 * writes its own `created_by_type` markers. CLI auto-fallback bearer
 * is admitted by the gate; this is the path the demo flow uses.
 *
 * The function name follows the established convention
 * `thinkwork-${STAGE}-api-job-trigger` (see `terraform/modules/app/
 * lambda-api/handlers.tf`). graphql-http's env block is at the 4 KB
 * ceiling, so we construct the ARN at runtime from STAGE + region +
 * account rather than carrying it as an env var.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, scheduledJobs } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

interface RunResult {
  id: string;
  dispatched: boolean;
  statusCode: number | null;
  errorMessage: string | null;
}

export const runScheduledJob = async (
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<RunResult> => {
  const [row] = await db
    .select({
      id: scheduledJobs.id,
      tenant_id: scheduledJobs.tenant_id,
      trigger_type: scheduledJobs.trigger_type,
      agent_id: scheduledJobs.agent_id,
      routine_id: scheduledJobs.routine_id,
      prompt: scheduledJobs.prompt,
      eb_schedule_name: scheduledJobs.eb_schedule_name,
    })
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, args.id));

  if (!row) {
    return {
      id: args.id,
      dispatched: false,
      statusCode: null,
      errorMessage: "Scheduled job not found",
    };
  }

  await requireAdminOrServiceCaller(ctx, row.tenant_id, "run_scheduled_job");

  const stage = process.env.STAGE;
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!stage || !accountId) {
    throw new Error(
      "Cannot dispatch: STAGE and AWS_ACCOUNT_ID env vars are required on graphql-http.",
    );
  }
  const functionArn = `arn:aws:lambda:${region}:${accountId}:function:thinkwork-${stage}-api-job-trigger`;

  const payload = {
    triggerId: row.id,
    triggerType: row.trigger_type,
    tenantId: row.tenant_id,
    agentId: row.agent_id ?? undefined,
    routineId: row.routine_id ?? undefined,
    prompt: row.prompt ?? undefined,
    scheduleName: row.eb_schedule_name ?? undefined,
  };

  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: functionArn,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );

  if (res.FunctionError) {
    const detail = res.Payload
      ? new TextDecoder().decode(res.Payload).slice(0, 500)
      : res.FunctionError;
    return {
      id: row.id,
      dispatched: false,
      statusCode: res.StatusCode ?? null,
      errorMessage: `Lambda error: ${detail}`,
    };
  }

  return {
    id: row.id,
    dispatched: true,
    statusCode: res.StatusCode ?? null,
    errorMessage: null,
  };
};
