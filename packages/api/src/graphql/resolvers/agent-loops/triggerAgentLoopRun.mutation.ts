import {
  dispatchAgentLoop,
  type AgentLoopDispatchLedger,
} from "@thinkwork/agent-loops-core";
import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentWakeupRequests,
  agentLoopIterations,
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
      version: version
        ? {
            id: version.id,
            versionStatus: version.version_status,
            goalSpec: version.goal_spec,
            workerSpec: version.worker_spec,
            judgeSpec: version.judge_spec,
            loopPolicy: version.loop_policy,
          }
        : null,
      trigger: {
        family: "manual",
        source: "manual_run",
        actorType: actorId ? "user" : "system",
        actorId,
        idempotencyKey: args.input.idempotencyKey ?? null,
        correlationId: args.input.correlationId ?? null,
        inputSummary,
      },
      now,
    },
    createGraphqlAgentLoopLedger(),
  );

  const runId = "runId" in result ? result.runId : null;
  if (!runId) {
    throw new Error("AgentLoop dispatch did not create a run");
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

async function loadCurrentVersion(id?: string | null) {
  if (!id) return null;
  const [row] = await db
    .select()
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.id, id))
    .limit(1);
  return row ?? null;
}

function createGraphqlAgentLoopLedger(): AgentLoopDispatchLedger {
  return {
    async findRunByIdempotencyKey(input) {
      const [row] = await db
        .select()
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.tenant_id, input.tenantId),
            eq(agentLoopRuns.idempotency_key, input.idempotencyKey),
          ),
        )
        .limit(1);
      return row ? { id: row.id, status: row.status as never } : null;
    },

    async createRun(input) {
      const [row] = await db
        .insert(agentLoopRuns)
        .values({
          tenant_id: input.tenantId,
          agent_loop_id: input.agentLoopId,
          agent_loop_version_id: input.agentLoopVersionId ?? null,
          status: input.status,
          trigger_family: input.triggerFamily,
          trigger_source: input.triggerSource,
          scheduled_job_id: input.scheduledJobId ?? null,
          actor_type: input.actorType ?? null,
          actor_id: input.actorId ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          correlation_id: input.correlationId,
          current_iteration: input.currentIteration,
          policy_snapshot: input.policySnapshot,
          input_summary: input.inputSummary,
          error_code: input.errorCode ?? null,
          error_message: input.errorMessage ?? null,
          last_event_at: input.now,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning({ id: agentLoopRuns.id, status: agentLoopRuns.status });
      return { id: row.id, status: row.status as never };
    },

    async createIteration(input) {
      const [row] = await db
        .insert(agentLoopIterations)
        .values({
          tenant_id: input.tenantId,
          agent_loop_run_id: input.runId,
          iteration_number: input.iterationNumber,
          status: input.status,
          goal_mode_action: input.goalModeAction,
          input_summary: input.inputSummary,
          error_code: input.errorCode ?? null,
          error_message: input.errorMessage ?? null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning({ id: agentLoopIterations.id });
      return { id: row.id };
    },

    async enqueueWakeup(input) {
      const [row] = await db
        .insert(agentWakeupRequests)
        .values({
          tenant_id: input.tenantId,
          agent_id: input.agentId,
          source: input.source,
          trigger_detail: input.triggerDetail,
          reason: input.reason,
          payload: input.payload,
          status: "queued",
          idempotency_key: input.idempotencyKey,
          requested_by_actor_type: input.requestedByActorType ?? null,
          requested_by_actor_id: input.requestedByActorId ?? null,
          requested_at: input.now,
          created_at: input.now,
        })
        .returning({ id: agentWakeupRequests.id });
      return { id: row.id };
    },

    async markIterationWakeup(input) {
      await db
        .update(agentLoopIterations)
        .set({
          agent_wakeup_request_id: input.wakeupId,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
    },

    async markDispatchFailed(input) {
      await db
        .update(agentLoopRuns)
        .set({
          status: "failed",
          error_code: input.errorCode,
          error_message: input.errorMessage,
          finished_at: input.now,
          last_event_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopRuns.id, input.runId));
      await db
        .update(agentLoopIterations)
        .set({
          status: "failed",
          error_code: input.errorCode,
          error_message: input.errorMessage,
          finished_at: input.now,
          updated_at: input.now,
        })
        .where(eq(agentLoopIterations.id, input.iterationId));
    },

    async updateLoopAfterDispatch(input) {
      await db
        .update(agentLoops)
        .set({
          last_run_id: input.runId,
          last_run_status: input.status,
          last_run_at: input.now,
          last_run_summary: {
            triggerFamily: input.triggerFamily,
            currentIteration: input.currentIteration,
            ...input.summary,
          },
          updated_at: input.now,
        })
        .where(eq(agentLoops.id, input.loopId));
    },
  };
}
