/**
 * triggerRoutineRun (Plan 2026-05-01-005 §U7).
 *
 * Manually trigger a routine via SFN.StartExecution. Replaces the
 * legacy `thread_turns`-insert path under `triggers/`. Pre-emptively
 * inserts a `routine_executions` row keyed on the SFN execution ARN so
 * the run-list UI (Phase D) has something to render before the first
 * step-event lands.
 *
 * RequestResponse semantics — failure surfaces directly, not silently.
 */

import { eq } from "drizzle-orm";
import { routineExecutions, routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  StartExecutionCommand,
  getSfnClient,
} from "../../../lib/routines/sfn-client.js";

export async function triggerRoutineRun(
  _parent: unknown,
  args: { routineId: string; input?: Record<string, unknown> },
  ctx: GraphQLContext,
): Promise<unknown> {
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, args.routineId));
  if (!routine) {
    throw new Error(`Routine ${args.routineId} not found`);
  }
  await requireAdminOrApiKeyCaller(
    ctx,
    routine.tenant_id,
    "trigger_routine_run",
  );

  if (routine.engine !== "step_functions") {
    throw new Error(
      `Routine ${args.routineId} is on the legacy_python engine; trigger via the legacy thread_turns path until Phase E migrates it.`,
    );
  }
  if (!routine.state_machine_alias_arn) {
    throw new Error(
      `Routine ${args.routineId} has engine='step_functions' but no alias ARN — invariant violation.`,
    );
  }

  // Start the execution against the alias — that way version cutovers
  // via publishRoutineVersion are picked up automatically. Server-owned
  // runtime fields win over caller input so clients cannot redirect recipe
  // Lambda invocations by passing similarly named keys.
  const sfnInput = buildRoutineExecutionInput(args.input ?? {}, {
    tenantId: routine.tenant_id,
    routineId: routine.id,
  });
  const sfn = getSfnClient();
  const startResp = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: routine.state_machine_alias_arn,
      input: JSON.stringify(sfnInput),
    }),
  );
  if (!startResp.executionArn) {
    throw new Error("StartExecution returned no executionArn");
  }

  const [execRow] = await db
    .insert(routineExecutions)
    .values({
      tenant_id: routine.tenant_id,
      routine_id: routine.id,
      state_machine_arn: routine.state_machine_arn!,
      alias_arn: routine.state_machine_alias_arn,
      sfn_execution_arn: startResp.executionArn,
      trigger_source: "manual",
      input_json: args.input ?? {},
      status: "running",
      started_at: startResp.startDate ?? new Date(),
    })
    .returning();
  return snakeToCamel(execRow);
}

export function buildRoutineExecutionInput(
  userInput: Record<string, unknown>,
  routine: { tenantId: string; routineId: string },
): Record<string, unknown> {
  return {
    ...userInput,
    tenantId: routine.tenantId,
    routineId: routine.routineId,
    inboxApprovalFunctionName: runtimeFunctionName(
      "ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME",
      "routine-approval-callback",
    ),
    emailSendFunctionName: runtimeFunctionName(
      "EMAIL_SEND_FUNCTION_NAME",
      "email-send",
    ),
    routineTaskPythonFunctionName: runtimeFunctionName(
      "ROUTINE_TASK_PYTHON_FUNCTION_NAME",
      "routine-task-python",
    ),
    adminOpsMcpFunctionName: runtimeFunctionName(
      "ADMIN_OPS_MCP_FUNCTION_NAME",
      "admin-ops-mcp",
    ),
    slackSendFunctionName: runtimeFunctionName(
      "SLACK_SEND_FUNCTION_NAME",
      "slack-send",
    ),
  };
}

function runtimeFunctionName(envName: string, handlerName: string): string {
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const stage = process.env.STAGE;
  if (stage) return `thinkwork-${stage}-api-${handlerName}`;
  throw new Error(
    `Routines runtime is misconfigured: ${envName} env var is not set`,
  );
}
