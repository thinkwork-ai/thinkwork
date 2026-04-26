import type { GraphQLContext } from "../../context.js";
import {
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  and,
  db,
  desc,
  eq,
  snakeToCamel,
  threadTurns,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function agentWorkspaceReviews(
  _parent: unknown,
  args: {
    tenantId: string;
    agentId?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  await requireTenantMember(ctx, args.tenantId);

  const conditions = [
    eq(agentWorkspaceRuns.tenant_id, args.tenantId),
    eq(
      agentWorkspaceRuns.status,
      args.status?.toLowerCase() ?? "awaiting_review",
    ),
  ];
  if (args.agentId)
    conditions.push(eq(agentWorkspaceRuns.agent_id, args.agentId));

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const runs = await db
    .select()
    .from(agentWorkspaceRuns)
    .where(and(...conditions))
    .orderBy(desc(agentWorkspaceRuns.last_event_at))
    .limit(limit);

  const reviews: Record<string, unknown>[] = [];
  for (const run of runs) {
    const [latestEvent] = await db
      .select()
      .from(agentWorkspaceEvents)
      .where(
        and(
          eq(agentWorkspaceEvents.tenant_id, run.tenant_id),
          eq(agentWorkspaceEvents.run_id, run.id),
          eq(agentWorkspaceEvents.event_type, "review.requested"),
        ),
      )
      .orderBy(desc(agentWorkspaceEvents.created_at))
      .limit(1);

    const event = latestEvent
      ? snakeToCamel(latestEvent as Record<string, unknown>)
      : null;
    const eventPayload = (latestEvent?.payload ?? null) as Record<
      string,
      unknown
    > | null;
    let threadId: string | null = null;
    if (run.current_thread_turn_id) {
      const [turn] = await db
        .select({ threadId: threadTurns.thread_id })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.tenant_id, run.tenant_id),
            eq(threadTurns.id, run.current_thread_turn_id),
          ),
        )
        .limit(1);
      threadId = turn?.threadId ?? null;
    }

    reviews.push({
      run: snakeToCamel(run as Record<string, unknown>),
      latestEvent: event,
      threadId,
      reviewObjectKey: latestEvent?.source_object_key ?? null,
      targetPath: run.target_path,
      requestedAt: run.last_event_at.toISOString(),
      reason: latestEvent?.reason ?? null,
      payload: eventPayload ? JSON.stringify(eventPayload) : null,
      reviewBody: null,
      reviewEtag: latestEvent?.object_etag ?? null,
      reviewMissing: null,
      proposedChanges: [],
      events: [],
      decisionEvents: [],
    });
  }

  return reviews;
}
