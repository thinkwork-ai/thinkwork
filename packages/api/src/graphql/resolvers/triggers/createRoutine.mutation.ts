import type { GraphQLContext } from "../../context.js";
import {
	db,
	routines,
	snakeToCamel,
} from "../../utils.js";

export const createRoutine = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(routines)
		.values({
			tenant_id: i.tenantId,
			name: i.name,
			description: i.description,
			type: i.type ?? "scheduled",
			schedule: i.schedule,
			config: i.config ? JSON.parse(i.config) : undefined,
			agent_id: i.agentId,
			team_id: i.teamId,
		})
		.returning();
	return snakeToCamel(row);
};
