import { createHash } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import {
  agentWakeupRequests,
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  db,
  eq,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

type ReviewDecision = "accepted" | "cancelled" | "resumed";

interface DecisionArgs {
  runId: string;
  input?: {
    notes?: string | null;
    idempotencyKey?: string | null;
  } | null;
}

export async function acceptAgentWorkspaceReview(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "accepted");
}

export async function cancelAgentWorkspaceReview(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "cancelled");
}

export async function resumeAgentWorkspaceRun(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "resumed");
}

async function decideWorkspaceReview(
  args: DecisionArgs,
  ctx: GraphQLContext,
  decision: ReviewDecision,
): Promise<Record<string, unknown>> {
  const [run] = await db
    .select()
    .from(agentWorkspaceRuns)
    .where(eq(agentWorkspaceRuns.id, args.runId))
    .limit(1);
  if (!run) throw new Error("Workspace run not found");

  await requireTenantAdmin(ctx, run.tenant_id);

  if (decision !== "resumed" && run.status !== "awaiting_review") {
    throw new Error(`Workspace run is not awaiting review: ${run.status}`);
  }

  const actorId = await resolveCallerUserId(ctx);
  const now = new Date();
  const idempotencyKey =
    args.input?.idempotencyKey ??
    workspaceReviewDecisionIdempotencyKey(run.id, decision, args.input?.notes);
  const nextStatus = decision === "cancelled" ? "cancelled" : "pending";

  const [event] = await db
    .insert(agentWorkspaceEvents)
    .values({
      tenant_id: run.tenant_id,
      agent_id: run.agent_id,
      run_id: run.id,
      event_type: "review.responded",
      idempotency_key: idempotencyKey,
      bucket: "graphql",
      source_object_key: `graphql://workspace-review/${run.id}/${decision}`,
      sequencer: idempotencyKey,
      reason: `review_${decision}`,
      payload: {
        decision,
        notes: args.input?.notes ?? null,
        targetPath: run.target_path,
      },
      actor_type: "user",
      actor_id: actorId ?? null,
    })
    .onConflictDoNothing({
      target: [
        agentWorkspaceEvents.tenant_id,
        agentWorkspaceEvents.idempotency_key,
      ],
    })
    .returning({ id: agentWorkspaceEvents.id });

  const [updatedRun] = await db
    .update(agentWorkspaceRuns)
    .set({
      status: nextStatus,
      last_event_at: now,
      completed_at: decision === "cancelled" ? now : null,
      updated_at: now,
    })
    .where(
      and(
        eq(agentWorkspaceRuns.id, run.id),
        eq(agentWorkspaceRuns.tenant_id, run.tenant_id),
      ),
    )
    .returning();
  if (!updatedRun) throw new Error("Workspace run update failed");

  if (event && decision !== "cancelled") {
    const [wakeup] = await db
      .insert(agentWakeupRequests)
      .values({
        tenant_id: run.tenant_id,
        agent_id: run.agent_id,
        source: "workspace_event",
        trigger_detail: `workspace_event:${event.id}`,
        reason: `Workspace review ${decision}`,
        payload: {
          workspaceRunId: run.id,
          workspaceEventId: event.id,
          targetPath: run.target_path,
          decision,
          notes: args.input?.notes ?? null,
          causeType: "review.responded",
        },
        status: "queued",
        idempotency_key: idempotencyKey,
        requested_by_actor_type: "user",
        requested_by_actor_id: actorId ?? null,
      })
      .returning({ id: agentWakeupRequests.id });

    if (wakeup) {
      await db
        .update(agentWorkspaceRuns)
        .set({
          current_wakeup_request_id: wakeup.id,
          updated_at: new Date(),
        })
        .where(eq(agentWorkspaceRuns.id, run.id));
      return {
        ...snakeToCamel(updatedRun as Record<string, unknown>),
        currentWakeupRequestId: wakeup.id,
      };
    }
  }

  return snakeToCamel(updatedRun as Record<string, unknown>);
}

function workspaceReviewDecisionIdempotencyKey(
  runId: string,
  decision: ReviewDecision,
  notes?: string | null,
): string {
  return createHash("sha256")
    .update(`workspace-review:${runId}:${decision}:${notes ?? ""}`)
    .digest("hex");
}
