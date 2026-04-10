import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	artifacts,
	artifactToCamel,
} from "../../utils.js";

export const updateArtifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.title !== undefined) updates.title = i.title;
	if (i.type !== undefined) updates.type = i.type.toLowerCase();
	if (i.status !== undefined) updates.status = i.status.toLowerCase();
	if (i.content !== undefined) updates.content = i.content;
	if (i.s3Key !== undefined) updates.s3_key = i.s3Key;
	if (i.summary !== undefined) updates.summary = i.summary;
	if (i.metadata !== undefined)
		updates.metadata = i.metadata ? JSON.parse(i.metadata) : null;
	const [row] = await db
		.update(artifacts)
		.set(updates)
		.where(eq(artifacts.id, args.id))
		.returning();
	if (!row) throw new Error("Artifact not found");
	return artifactToCamel(row);
};
