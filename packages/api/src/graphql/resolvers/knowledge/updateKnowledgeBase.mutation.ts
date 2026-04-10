import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	knowledgeBases,
	snakeToCamel,
} from "../../utils.js";

export const updateKnowledgeBase = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, any> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.description !== undefined) updates.description = i.description;
	const [row] = await db
		.update(knowledgeBases)
		.set(updates)
		.where(eq(knowledgeBases.id, args.id))
		.returning();
	if (!row) throw new Error("Knowledge base not found");
	return snakeToCamel(row);
};
