import {
  dispatchAgentLoop,
  dispatchNeedsThread,
  resolveDispatchableVersion,
  workerAgentId,
} from "@thinkwork/agent-loops-core";
import {
  createDbAgentLoopLedger,
  findAgentLoopRunByIdempotencyKey,
  loadActiveSpaceId,
  loadAgentDefaultSpaceId,
} from "@thinkwork/database-pg";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  db,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  agentLoopRowToGraphql,
  parseAwsJsonObject,
  requireAgentLoopAdmin,
} from "./types.js";
import { ensureThreadForWork } from "../../../lib/thread-helpers.js";

type TriggerAgentLoopRunArgs = {
  input: {
    agentLoopId: string;
    idempotencyKey?: string | null;
    correlationId?: string | null;
    inputSummary?: unknown;
  };
};

export async function triggerAgentLoopRun(
  _parent: unknown,
  args: TriggerAgentLoopRunArgs,
  ctx: GraphQLContext,
): Promise<unknown> {
  const [loop] = await db
    .select()
    .from(agentLoops)
    .where(eq(agentLoops.id, args.input.agentLoopId))
    .limit(1);
  if (!loop) {
    throw new Error(`AgentLoop ${args.input.agentLoopId} not found`);
  }

  await requireAgentLoopAdmin(ctx, loop.tenant_id, "trigger_agent_loop_run");

  const version = await loadCurrentVersion(loop.current_version_id);
  const actorId = await resolveCallerUserId(ctx);
  const inputSummary = parseAwsJsonObject(args.input.inputSummary);
  const now = new Date();
  const idempotencyKey = args.input.idempotencyKey ?? null;
  const existingIdempotentRun = idempotencyKey
    ? await findAgentLoopRunByIdempotencyKey(db, loop.tenant_id, idempotencyKey)
    : null;
  if (existingIdempotentRun) {
    const [run] = await db
      .select()
      .from(agentLoopRuns)
      .where(eq(agentLoopRuns.id, existingIdempotentRun.id))
      .limit(1);
    if (!run) {
      throw new Error(
        `AgentLoop run ${existingIdempotentRun.id} not found after idempotency lookup`,
      );
    }
    return agentLoopRowToGraphql(run);
  }

  // Single-sourced target resolution (THINK-137 U3): resolve the dispatchable
  // version from target_spec (or the legacy read-fallback) once, then derive
  // routine/thread decisions from it.
  const dispatchVersion = version ? resolveDispatchableVersion(version) : null;
  // Routine-bearing Automations defer their continuation to job-trigger
  // (KTD-3): graphql-http never invokes the routine executor inline — the
  // run/iteration rows are created here, then job-trigger executes the
  // actions and enqueues (or skips) the wakeup.
  const routineActionsSpec = dispatchVersion?.routineActionsSpec ?? null;
  const hasRoutineActions = (routineActionsSpec?.actions.length ?? 0) > 0;

  const workerId = workerAgentId(dispatchVersion?.workerSpec ?? null);
  const configuredSpaceId = loop.space_id
    ? await loadActiveSpaceId(db, loop.tenant_id, loop.space_id)
    : null;
  // R4: agent_thread targets inherit the worker default Space when unset; a
  // headless routine/workflow target must NOT (see dispatchNeedsThread).
  const isAgentThreadTarget = dispatchVersion?.targetKind === "agent_thread";
  const executionSpaceId =
    configuredSpaceId ??
    (isAgentThreadTarget && workerId
      ? await loadAgentDefaultSpaceId(db, loop.tenant_id, workerId)
      : null);
  // No Space ⇒ no thread (THINK-137 U4, R4). Shared seam with job-trigger:
  // a thread is created ONLY for an agent_thread target with a resolved Space.
  const executionThread =
    dispatchNeedsThread(dispatchVersion, executionSpaceId) &&
    workerId &&
    loop.lifecycle_status === "active"
      ? await ensureThreadForWork({
          tenantId: loop.tenant_id,
          agentId: workerId,
          spaceId: executionSpaceId ?? undefined,
          userId: actorId ?? undefined,
          title: `Automation: ${loop.name}`,
          channel: "schedule",
        })
      : null;

  const result = await dispatchAgentLoop(
    {
      tenantId: loop.tenant_id,
      loop: {
        id: loop.id,
        tenantId: loop.tenant_id,
        name: loop.name,
        enabled: loop.enabled,
        lifecycleStatus: loop.lifecycle_status,
      },
      version: dispatchVersion,
      trigger: {
        family: "manual",
        source: "manual_run",
        actorType: actorId ? "user" : "system",
        actorId,
        threadId: executionThread?.threadId ?? null,
        spaceId: executionSpaceId,
        idempotencyKey,
        correlationId: args.input.correlationId ?? null,
        inputSummary,
      },
      now,
    },
    // graphql-http omits the routine runner hook — routine-bearing
    // Automations defer their continuation to job-trigger (KTD-3).
    createDbAgentLoopLedger(db),
    { deferContinuation: hasRoutineActions },
  );

  const runId = "runId" in result ? result.runId : null;
  if (!runId) {
    throw new Error("AgentLoop dispatch did not create a run");
  }

  if (result.status === "deferred") {
    await invokeAgentLoopContinueDispatch({
      tenantId: loop.tenant_id,
      agentLoopId: loop.id,
      runId,
      iterationId: "iterationId" in result ? result.iterationId : "",
      actorId,
      threadId: executionThread?.threadId ?? null,
      spaceId: executionSpaceId,
    });
  }
  const [run] = await db
    .select()
    .from(agentLoopRuns)
    .where(eq(agentLoopRuns.id, runId))
    .limit(1);
  if (!run) {
    throw new Error(`AgentLoop run ${runId} not found after dispatch`);
  }

  return agentLoopRowToGraphql(run);
}

/** Event-invoke of job-trigger for the deferred continuation. The run row
 * already exists in `queued`; job-trigger marks it failed if the
 * continuation errors, so this async handoff still surfaces failures on
 * the run ledger rather than losing them. */
async function invokeAgentLoopContinueDispatch(input: {
  tenantId: string;
  agentLoopId: string;
  runId: string;
  iterationId: string;
  actorId: string | null;
  threadId: string | null;
  spaceId: string | null;
}): Promise<void> {
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const stage = process.env.STAGE;
  const fnName =
    process.env.JOB_TRIGGER_FUNCTION_NAME ??
    (stage ? `thinkwork-${stage}-api-job-trigger` : null);
  if (!fnName) {
    throw new Error(
      "Cannot dispatch routine actions: JOB_TRIGGER_FUNCTION_NAME/STAGE not configured",
    );
  }
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          triggerType: "agent_loop_continue_dispatch",
          triggerId: input.runId,
          tenantId: input.tenantId,
          agentLoopId: input.agentLoopId,
          runId: input.runId,
          iterationId: input.iterationId,
          actorId: input.actorId,
          threadId: input.threadId,
          spaceId: input.spaceId ?? undefined,
        }),
      ),
    }),
  );
  if (typeof response.StatusCode === "number" && response.StatusCode >= 300) {
    throw new Error(
      `job-trigger continuation invoke returned ${response.StatusCode}`,
    );
  }
}

async function loadCurrentVersion(id?: string | null) {
  if (!id) return null;
  const [row] = await db
    .select()
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.id, id))
    .limit(1);
  return row ?? null;
}
