import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
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

  if (args.input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(agentLoopRuns)
      .where(
        and(
          eq(agentLoopRuns.tenant_id, loop.tenant_id),
          eq(agentLoopRuns.agent_loop_id, loop.id),
          eq(agentLoopRuns.idempotency_key, args.input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return agentLoopRowToGraphql(existing);
  }

  const version = await loadCurrentVersion(loop.current_version_id);
  const actorId = await resolveCallerUserId(ctx);
  const inputSummary = parseAwsJsonObject(args.input.inputSummary);
  const now = new Date();

  const [run] = await db
    .insert(agentLoopRuns)
    .values({
      tenant_id: loop.tenant_id,
      agent_loop_id: loop.id,
      agent_loop_version_id: version?.id ?? null,
      status: "queued",
      trigger_family: "manual",
      trigger_source: "manual_run",
      actor_type: actorId ? "user" : "system",
      actor_id: actorId,
      idempotency_key: args.input.idempotencyKey ?? null,
      correlation_id:
        args.input.correlationId ??
        args.input.idempotencyKey ??
        `agent-loop:${loop.id}:${now.getTime()}`,
      current_iteration: 1,
      policy_snapshot: version?.loop_policy ?? {},
      input_summary: inputSummary,
      last_event_at: now,
      created_at: now,
      updated_at: now,
    })
    .returning();

  await db.insert(agentLoopIterations).values({
    tenant_id: loop.tenant_id,
    agent_loop_run_id: run.id,
    iteration_number: 1,
    status: "queued",
    goal_mode_action: "manual_run",
    input_summary: inputSummary,
    created_at: now,
    updated_at: now,
  });

  await db
    .update(agentLoops)
    .set({
      last_run_id: run.id,
      last_run_status: run.status,
      last_run_at: now,
      last_run_summary: {
        triggerFamily: "manual",
        currentIteration: 1,
      },
      updated_at: now,
    })
    .where(eq(agentLoops.id, loop.id));

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
