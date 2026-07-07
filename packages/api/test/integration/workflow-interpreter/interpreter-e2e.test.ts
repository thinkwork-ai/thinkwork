/**
 * Integration: the shared workflow interpreter, end-to-end on a DEPLOYED
 * stage (THINK-219 U9).
 *
 * This is deliberately a live-runtime proof, not a bare-Lambda unit: it
 * seeds a real workflow + published version in the stage database, starts
 * the deployed interpreter state machine the same way triggerWorkflowRun
 * does, and asserts the run ledger (workflow_runs + workflow_run_events)
 * reaches terminal with the expected event shape. A second pass invokes the
 * deployed job-trigger Lambda with a `workflow_schedule` payload — the exact
 * entry point AWS Scheduler uses — and asserts the scheduled path produces
 * the same ledger shape as the manual path (single-dispatcher requirement).
 *
 * Gating (both required):
 *   DATABASE_URL             — stage Aurora connection string
 *   WORKFLOW_INTERPRETER_E2E — "1" to opt in (drives real Pi agent turns on
 *                              the deployed stack; takes minutes)
 *
 * Run:
 *   DATABASE_URL=... WORKFLOW_INTERPRETER_E2E=1 STAGE=dev \
 *     npx vitest run test/integration/workflow-interpreter --testTimeout=1200000
 */

import { describe, it, expect } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  createDb,
  createInterpreterWorkflowRun,
  ensureInterpreterBinding,
  markInterpreterRunStarted,
} from "@thinkwork/database-pg";
import {
  agents,
  workflowRunEvents,
  workflowRuns,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";

// node-pg's TLS validator rejects RDS's default certificate chain on
// macOS / CI runners; sslmode=no-verify keeps encryption in transit and only
// disables CA verification (matches sandbox/ + compliance-emit harnesses).
const DATABASE_URL = process.env.DATABASE_URL?.replace(
  "sslmode=require",
  "sslmode=no-verify",
);
const STAGE = process.env.STAGE ?? "dev";
const OPTED_IN = process.env.WORKFLOW_INTERPRETER_E2E === "1";
const skip = !DATABASE_URL || !OPTED_IN;

const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
]);

type Db = ReturnType<typeof createDb>;

async function resolveStateMachineArn(): Promise<string> {
  const ssm = new SSMClient({});
  const param = await ssm.send(
    new GetParameterCommand({
      Name: `/thinkwork/${STAGE}/workflow-interpreter/state-machine-arn`,
    }),
  );
  const arn = param.Parameter?.Value;
  if (!arn) throw new Error("interpreter state-machine ARN missing from SSM");
  return arn;
}

async function resolveTenantAndAgent(db: Db) {
  const [agent] = await db
    .select({ id: agents.id, tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.is_platform_default, true))
    .limit(1);
  if (!agent) throw new Error("no platform-default agent on this stage");
  return { tenantId: agent.tenant_id, agentId: agent.id };
}

async function seedWorkflow(db: Db, tenantId: string, tag: string) {
  const slug = `itest-interpreter-${tag}`;
  const [workflow] = await db
    .insert(workflows)
    .values({
      tenant_id: tenantId,
      name: `itest interpreter ${tag}`,
      slug,
      description:
        "Workflow-interpreter integration test seed — safe to archive.",
      lifecycle_status: "active",
      primary_trigger_family: "manual",
    })
    .returning({ id: workflows.id });

  const definition = {
    version: 1,
    steps: [
      {
        id: "work",
        kind: "agent",
        objective:
          "This is an automated integration test of the workflow engine. " +
          "Do not use any tools. Reply with exactly one short sentence " +
          "confirming the test step ran, then finish the goal as complete.",
        tokenBudget: 20_000,
      },
    ],
    continuationPolicy: {
      exitSignal: "the confirmation sentence has been produced",
      maxIterations: 3,
    },
  };

  const [version] = await db
    .insert(workflowVersions)
    .values({
      tenant_id: tenantId,
      workflow_id: workflow.id,
      version_number: 1,
      version_status: "published",
      definition_snapshot: definition,
      published_at: new Date(),
    })
    .returning({ id: workflowVersions.id });

  await db
    .update(workflows)
    .set({ current_version_id: version.id, current_version_number: 1 })
    .where(eq(workflows.id, workflow.id));

  return { workflowId: workflow.id, versionId: version.id };
}

async function waitForTerminal(db: Db, runId: string) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    const [run] = await db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);
    if (run && TERMINAL_STATUSES.has(run.status)) return run.status;
    if (Date.now() > deadline) {
      throw new Error(
        `run ${runId} did not reach terminal within ${RUN_TIMEOUT_MS}ms (last status: ${run?.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function eventShape(db: Db, runId: string) {
  const rows = await db
    .select({ event_type: workflowRunEvents.event_type })
    .from(workflowRunEvents)
    .where(eq(workflowRunEvents.workflow_run_id, runId))
    .orderBy(asc(workflowRunEvents.id));
  return rows.map((row) => row.event_type);
}

function assertWellFormedLedger(shape: string[]) {
  expect(shape).toContain("workflow_step_started");
  expect(shape).toContain("workflow_policy_decision");
  // The finalize hook records the evidence-bearing completion for every
  // successful agent turn.
  expect(
    shape.filter(
      (t) => t === "workflow_step_finished" || t === "workflow_step_failed",
    ).length,
  ).toBeGreaterThan(0);
}

describe.skipIf(skip)("integration: shared workflow interpreter (live)", () => {
  it("manual start runs the loop to terminal with a well-formed ledger", async () => {
    const db = createDb(DATABASE_URL!);
    const { tenantId, agentId } = await resolveTenantAndAgent(db);
    const tag = `m${Date.now().toString(36)}`;
    const { workflowId, versionId } = await seedWorkflow(db, tenantId, tag);

    const stateMachineArn = await resolveStateMachineArn();
    const binding = await ensureInterpreterBinding(db, {
      tenantId,
      workflowId,
      stateMachineArn,
    });
    const { run } = await createInterpreterWorkflowRun(db, {
      tenantId,
      workflowId,
      workflowVersionId: versionId,
      engineBindingId: binding.id,
      triggerFamily: "manual",
      triggerSource: "integration_test",
      idempotencyKey: `itest:${tag}`,
      inputSummary: {
        agentId,
        workflowName: `itest interpreter ${tag}`,
        spaceId: null,
      },
    });

    const sfn = new SFNClient({});
    const execution = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: `run-${run.id}-r0`,
        input: JSON.stringify({
          cursor: {
            workflowRunId: run.id,
            tenantId,
            stepPointer: 0,
            iteration: 1,
            loopCycleCount: 0,
            rolloverCount: 0,
          },
        }),
      }),
    );
    await markInterpreterRunStarted(db, {
      tenantId,
      workflowId,
      runId: run.id,
      executionArn: execution.executionArn!,
    });

    const terminal = await waitForTerminal(db, run.id);
    const shape = await eventShape(db, run.id);
    assertWellFormedLedger(shape);
    expect(terminal).toBe("succeeded");
  });

  it("workflow_schedule fire via the deployed job-trigger produces the same ledger shape (AE4 + single dispatcher)", async () => {
    const db = createDb(DATABASE_URL!);
    const { tenantId } = await resolveTenantAndAgent(db);
    const tag = `s${Date.now().toString(36)}`;
    const { workflowId } = await seedWorkflow(db, tenantId, tag);

    const lambda = new LambdaClient({});
    const fireId = `itest-fire-${tag}`;
    const payload = {
      triggerId: `itest-trigger-${tag}`,
      triggerType: "workflow_schedule",
      tenantId,
      workflowId,
      fireId,
    };
    const invoke = () =>
      lambda.send(
        new InvokeCommand({
          FunctionName: `thinkwork-${STAGE}-api-job-trigger`,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );

    const first = await invoke();
    expect(first.FunctionError).toBeUndefined();
    // Duplicate fire (same fireId) must not create a second run (AE4).
    const second = await invoke();
    expect(second.FunctionError).toBeUndefined();

    const runs = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.tenant_id, tenantId),
          eq(workflowRuns.workflow_id, workflowId),
        ),
      );
    expect(runs).toHaveLength(1);

    const terminal = await waitForTerminal(db, runs[0].id);
    const shape = await eventShape(db, runs[0].id);
    assertWellFormedLedger(shape);
    expect(terminal).toBe("succeeded");
  });
});
