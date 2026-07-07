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
  scheduledJobs,
  users,
  workflowEvidence,
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
  // Pi requires a human invoker on every agent turn (user_id) — act as an
  // existing tenant user, the same way schedule fires act as the job owner.
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tenant_id, agent.tenant_id))
    .limit(1);
  if (!user) throw new Error("no user in the platform agent's tenant");
  return { tenantId: agent.tenant_id, agentId: agent.id, userId: user.id };
}

const AGENT_LOOP_DEFINITION = {
  version: 1,
  steps: [
    {
      id: "work",
      kind: "agent",
      objective:
        "This is an automated integration test of the workflow engine. " +
        "Reply with exactly one short sentence confirming the test step " +
        "ran, then immediately call the goal_complete tool — completion " +
        "is signaled ONLY by that tool call.",
      tokenBudget: 20_000,
    },
  ],
  continuationPolicy: {
    exitSignal: "the confirmation sentence has been produced",
    maxIterations: 3,
  },
};

async function seedWorkflow(
  db: Db,
  tenantId: string,
  tag: string,
  definition: Record<string, unknown> = AGENT_LOOP_DEFINITION,
) {
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

  const [version] = await db
    .insert(workflowVersions)
    .values({
      tenant_id: tenantId,
      workflow_id: workflow.id,
      version_number: 1,
      version_status: "active",
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

/** Start a seeded workflow's run through the deployed interpreter, exactly
 * like triggerWorkflowRun does. Shared by every manual-start case. */
async function startManualRun(
  db: Db,
  input: {
    tenantId: string;
    agentId: string;
    userId: string;
    workflowId: string;
    versionId: string;
    tag: string;
  },
) {
  const stateMachineArn = await resolveStateMachineArn();
  const binding = await ensureInterpreterBinding(db, {
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    stateMachineArn,
  });
  const { run } = await createInterpreterWorkflowRun(db, {
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    workflowVersionId: input.versionId,
    engineBindingId: binding.id,
    triggerFamily: "manual",
    triggerSource: "integration_test",
    idempotencyKey: `itest:${input.tag}`,
    inputSummary: {
      agentId: input.agentId,
      workflowName: `itest interpreter ${input.tag}`,
      spaceId: null,
      requestedByUserId: input.userId,
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
          tenantId: input.tenantId,
          stepPointer: 0,
          iteration: 1,
          loopCycleCount: 0,
          rolloverCount: 0,
        },
      }),
    }),
  );
  await markInterpreterRunStarted(db, {
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    runId: run.id,
    executionArn: execution.executionArn!,
  });
  return run;
}

async function waitForStatus(db: Db, runId: string, wanted: string) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    const [run] = await db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);
    if (run && run.status === wanted) return;
    if (run && TERMINAL_STATUSES.has(run.status)) {
      throw new Error(
        `run ${runId} reached terminal ${run.status} while waiting for ${wanted}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `run ${runId} never reached ${wanted} (last status: ${run?.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

async function resolveApproval(input: {
  tenantId: string;
  runId: string;
  approved: boolean;
}) {
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: `thinkwork-${STAGE}-api-workflow-resume`,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(
        JSON.stringify({
          tenantId: input.tenantId,
          workflowRunId: input.runId,
          approved: input.approved,
          note: "integration test decision",
        }),
      ),
    }),
  );
  expect(res.FunctionError).toBeUndefined();
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
    const { tenantId, agentId, userId } = await resolveTenantAndAgent(db);
    const tag = `m${Date.now().toString(36)}`;
    const { workflowId, versionId } = await seedWorkflow(db, tenantId, tag);
    const run = await startManualRun(db, {
      tenantId,
      agentId,
      userId,
      workflowId,
      versionId,
      tag,
    });

    const terminal = await waitForTerminal(db, run.id);
    const shape = await eventShape(db, run.id);
    assertWellFormedLedger(shape);
    expect(terminal).toBe("succeeded");
  });

  it("workflow_schedule fire via the deployed job-trigger produces the same ledger shape (AE4 + single dispatcher)", async () => {
    const db = createDb(DATABASE_URL!);
    const { tenantId, userId } = await resolveTenantAndAgent(db);
    const tag = `s${Date.now().toString(36)}`;
    const { workflowId } = await seedWorkflow(db, tenantId, tag);

    // A real scheduled_jobs row, exactly as job-schedule-manager would write
    // it: job-trigger resolves the run's acting user from the job owner.
    const [job] = await db
      .insert(scheduledJobs)
      .values({
        tenant_id: tenantId,
        trigger_type: "workflow_schedule",
        workflow_id: workflowId,
        name: `itest interpreter schedule ${tag}`,
        created_by_type: "user",
        created_by_id: userId,
        enabled: true,
      })
      .returning({ id: scheduledJobs.id });

    const lambda = new LambdaClient({});
    const fireId = `itest-fire-${tag}`;
    const payload = {
      triggerId: job.id,
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

  it("full step taxonomy: http → emit_event (templated) → approval approve reaches succeeded (THINK-215)", async () => {
    const db = createDb(DATABASE_URL!);
    const { tenantId, agentId, userId } = await resolveTenantAndAgent(db);
    const tag = `t${Date.now().toString(36)}`;
    const { workflowId, versionId } = await seedWorkflow(db, tenantId, tag, {
      version: 1,
      steps: [
        {
          id: "fetch",
          kind: "http",
          method: "GET",
          url: "https://checkip.amazonaws.com",
        },
        {
          id: "announce",
          kind: "emit_event",
          eventType: "itest.taxonomy",
          payload: { sourceIp: "{{ steps.fetch.output.bodyPreview }}" },
        },
        {
          id: "sign-off",
          kind: "approval",
          prompt: "Approve the integration-test run?",
        },
      ],
    });
    const run = await startManualRun(db, {
      tenantId,
      agentId,
      userId,
      workflowId,
      versionId,
      tag,
    });

    await waitForStatus(db, run.id, "waiting_for_human");
    await resolveApproval({ tenantId, runId: run.id, approved: true });

    const terminal = await waitForTerminal(db, run.id);
    expect(terminal).toBe("succeeded");

    const shape = await eventShape(db, run.id);
    expect(shape.filter((t) => t === "workflow_step_finished")).toHaveLength(3);
    expect(shape).toContain("workflow_approval_decision");
    expect(shape).toContain("workflow_policy_decision");
    expect(shape).not.toContain("workflow_step_failed");

    // Step outputs landed as evidence, and the emit_event payload resolved
    // the {{ steps.fetch.output.bodyPreview }} reference to a real value.
    const outputs = await db
      .select({ summary: workflowEvidence.summary })
      .from(workflowEvidence)
      .where(
        and(
          eq(workflowEvidence.workflow_run_id, run.id),
          eq(workflowEvidence.evidence_type, "step_output"),
        ),
      );
    expect(outputs.length).toBeGreaterThanOrEqual(2);
    const announce = outputs
      .map((row) => row.summary as Record<string, any>)
      .find((s) => s.stepId === "announce");
    expect(String(announce?.output?.payload?.sourceIp ?? "")).toMatch(
      /\d+\.\d+\.\d+\.\d+/,
    );
  });

  it("approval deny cancels the run with the decision on the ledger (THINK-215)", async () => {
    const db = createDb(DATABASE_URL!);
    const { tenantId, agentId, userId } = await resolveTenantAndAgent(db);
    const tag = `d${Date.now().toString(36)}`;
    const { workflowId, versionId } = await seedWorkflow(db, tenantId, tag, {
      version: 1,
      steps: [
        { id: "sign-off", kind: "approval", prompt: "Deny this test run." },
      ],
    });
    const run = await startManualRun(db, {
      tenantId,
      agentId,
      userId,
      workflowId,
      versionId,
      tag,
    });

    await waitForStatus(db, run.id, "waiting_for_human");
    await resolveApproval({ tenantId, runId: run.id, approved: false });

    const terminal = await waitForTerminal(db, run.id);
    expect(terminal).toBe("canceled");
    const shape = await eventShape(db, run.id);
    expect(shape).toContain("workflow_approval_decision");
  });
});
