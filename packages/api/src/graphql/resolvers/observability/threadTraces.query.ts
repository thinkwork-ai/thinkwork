/**
 * PRD-20: Query traces associated with a thread via cost_events trace_id.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, sql,
	costEvents, agents,
} from "../../utils.js";

export const threadTraces = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const rows = await db
		.select({
			traceId: costEvents.trace_id,
			threadId: costEvents.thread_id,
			agentId: costEvents.agent_id,
			agentName: agents.name,
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

	return rows.map((r) => ({
		...r,
		estimated: (r.metadata as any)?.estimated === true,
		createdAt: r.createdAt?.toISOString(),
	}));
};
