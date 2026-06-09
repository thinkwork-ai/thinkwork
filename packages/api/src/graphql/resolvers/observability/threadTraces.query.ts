/**
 * PRD-20: Query traces associated with a thread via cost_events trace_id.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, sql, costEvents, agents } from "../../utils.js";

export const threadTraces = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const rows = await db
    .select({
      traceId: costEvents.trace_id,
      requestId: costEvents.request_id,
      eventType: costEvents.event_type,
      threadId: costEvents.thread_id,
      agentId: costEvents.agent_id,
      agentName: agents.name,
      runtimeType: costEvents.runtime_type,
      model: costEvents.model,
      inputTokens: costEvents.input_tokens,
      outputTokens: costEvents.output_tokens,
      durationMs: costEvents.duration_ms,
      costUsd: sql<number>`amount_usd::float`,
      metadata: costEvents.metadata,
      createdAt: costEvents.created_at,
    })
    .from(costEvents)
    .leftJoin(agents, eq(costEvents.agent_id, agents.id))
    .where(
      and(
        eq(costEvents.thread_id, args.threadId),
        eq(costEvents.tenant_id, args.tenantId),
        eq(costEvents.event_type, "llm"),
      ),
    )
    .orderBy(sql`${costEvents.created_at} DESC`)
    .limit(100);

  return rows.map((r) => {
    const metadata =
      r.metadata && typeof r.metadata === "object"
        ? (r.metadata as Record<string, unknown>)
        : {};
    return {
      ...r,
      estimated: metadata.estimated === true,
      source: typeof metadata.source === "string" ? metadata.source : null,
      parentRequestId:
        typeof metadata.parent_request_id === "string"
          ? metadata.parent_request_id
          : null,
      toolCallId:
        typeof metadata.tool_call_id === "string"
          ? metadata.tool_call_id
          : null,
      toolName:
        typeof metadata.tool_name === "string" ? metadata.tool_name : null,
      profileRunId:
        typeof metadata.profile_run_id === "string"
          ? metadata.profile_run_id
          : null,
      profileId:
        typeof metadata.profile_id === "string" ? metadata.profile_id : null,
      profileSlug:
        typeof metadata.profile_slug === "string"
          ? metadata.profile_slug
          : null,
      profileName:
        typeof metadata.profile_name === "string"
          ? metadata.profile_name
          : null,
      laneKey: typeof metadata.lane_key === "string" ? metadata.lane_key : null,
      profileStatus:
        typeof metadata.profile_status === "string"
          ? metadata.profile_status
          : null,
      loopId: typeof metadata.loop_id === "string" ? metadata.loop_id : null,
      loopOwnerType:
        typeof metadata.loop_owner_type === "string"
          ? metadata.loop_owner_type
          : null,
      loopOwnerSlug:
        typeof metadata.loop_owner_slug === "string"
          ? metadata.loop_owner_slug
          : null,
      loopIterationIndex:
        typeof metadata.loop_iteration_index === "number"
          ? metadata.loop_iteration_index
          : null,
      loopPhase:
        typeof metadata.loop_phase === "string" ? metadata.loop_phase : null,
      loopStatus:
        typeof metadata.loop_status === "string" ? metadata.loop_status : null,
      loopVerdict:
        typeof metadata.loop_verdict === "string"
          ? metadata.loop_verdict
          : null,
      reviewerRole: metadata.reviewer_role === true,
      loopEvidence: metadata.loop_evidence ?? null,
      modelRoutingStatus:
        typeof metadata.model_routing_status === "string"
          ? metadata.model_routing_status
          : null,
      ruleSource: metadata.rule_source ?? null,
      match: metadata.match ?? null,
      metadata,
      createdAt: r.createdAt?.toISOString(),
    };
  });
};
