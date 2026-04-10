import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	artifacts,
	artifactToCamel,
} from "../../utils.js";

export const artifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(artifacts).where(eq(artifacts.id, args.id));
	return row ? artifactToCamel(row) : null;
};
