import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	routines,
	snakeToCamel,
} from "../../utils.js";

export const updateRoutine = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.description !== undefined) updates.description = i.description;
	if (i.type !== undefined) updates.type = i.type;
	if (i.status !== undefined) updates.status = i.status;
	if (i.schedule !== undefined) updates.schedule = i.schedule;
	if (i.config !== undefined) updates.config = JSON.parse(i.config);
	if (i.teamId !== undefined) updates.team_id = i.teamId;
	if (i.agentId !== undefined) updates.agent_id = i.agentId;
	const [row] = await db.update(routines).set(updates).where(eq(routines.id, args.id)).returning();
	if (!row) throw new Error("Routine not found");
	return snakeToCamel(row);
};
