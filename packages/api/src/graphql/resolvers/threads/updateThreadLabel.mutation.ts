import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	threadLabels,
	snakeToCamel,
} from "../../utils.js";

export const updateThreadLabel = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = {};
	if (i.name !== undefined) updates.name = i.name;
	if (i.color !== undefined) updates.color = i.color;
	if (i.description !== undefined) updates.description = i.description;
	const [row] = await db.update(threadLabels).set(updates).where(eq(threadLabels.id, args.id)).returning();
	if (!row) throw new Error("Label not found");
	return snakeToCamel(row);
};
