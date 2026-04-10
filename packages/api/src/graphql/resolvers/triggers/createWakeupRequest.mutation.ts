import type { GraphQLContext } from "../../context.js";
import {
	db,
	agentWakeupRequests,
	snakeToCamel,
} from "../../utils.js";

export const createWakeupRequest = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(agentWakeupRequests)
		.values({
			tenant_id: i.tenantId,
			agent_id: i.agentId,
			source: i.source,
			trigger_detail: i.triggerDetail,
			reason: i.reason,
			payload: i.payload ? JSON.parse(i.payload) : undefined,
			idempotency_key: i.idempotencyKey,
			requested_by_actor_type: i.requestedByActorType,
			requested_by_actor_id: i.requestedByActorId,
		})
		.returning();
	return snakeToCamel(row);
};
