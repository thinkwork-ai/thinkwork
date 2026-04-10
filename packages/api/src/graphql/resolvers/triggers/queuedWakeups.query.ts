import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	agentWakeupRequests,
	snakeToCamel,
} from "../../utils.js";

export const queuedWakeups = async (_parent: any, args: any, _ctx: GraphQLContext) => {
	const rows = await db
		.select()
		.from(agentWakeupRequests)
		.where(
			and(
				eq(agentWakeupRequests.tenant_id, args.tenantId),
				eq(agentWakeupRequests.status, "queued"),
			),
		);

	return rows.map((r) => snakeToCamel(r));
};
