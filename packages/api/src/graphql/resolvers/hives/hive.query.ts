import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hives, hiveAgents, hiveUsers,
	snakeToCamel,
} from "../../utils.js";

export const hive = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(hives).where(eq(hives.id, args.id));
	if (!row) return null;
	const hiveId = row.id;
	const [agentRows, userRows] = await Promise.all([
		db.select().from(hiveAgents).where(eq(hiveAgents.hive_id, hiveId)),
		db.select().from(hiveUsers).where(eq(hiveUsers.hive_id, hiveId)),
	]);

	// Resolve nested agent and user objects via DataLoaders
	const [resolvedAgents, resolvedUsers] = await Promise.all([
		Promise.all(agentRows.map((r) => ctx.loaders.agent.load(r.agent_id))),
		Promise.all(userRows.map((r) => ctx.loaders.user.load(r.user_id))),
	]);

	return {
		...snakeToCamel(row),
		agents: agentRows.map((r, i) => ({ ...snakeToCamel(r), agent: resolvedAgents[i] ?? null })),
		users: userRows.map((r, i) => ({ ...snakeToCamel(r), user: resolvedUsers[i] ?? null })),
	};
};
