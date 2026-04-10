import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	artifacts,
} from "../../utils.js";

export const deleteArtifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db
		.delete(artifacts)
		.where(eq(artifacts.id, args.id))
		.returning();
	return !!row;
};
