import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	teams, teamAgents, teamUsers,
	snakeToCamel,
} from "../../utils.js";

export const team = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(teams).where(eq(teams.id, args.id));
	if (!row) return null;
	const teamId = row.id;
	const [agentRows, userRows] = await Promise.all([
		db.select().from(teamAgents).where(eq(teamAgents.team_id, teamId)),
		db.select().from(teamUsers).where(eq(teamUsers.team_id, teamId)),
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
