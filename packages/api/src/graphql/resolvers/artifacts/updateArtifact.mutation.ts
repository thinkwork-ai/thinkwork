import type { GraphQLContext } from "../../context.js";
import {
	db, eq, randomUUID,
	artifacts,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import {
	artifactContentBelongsInPayloadStore,
	artifactToCamelWithPayload,
	persistArtifactContentPayload,
} from "./payload.js";

export const updateArtifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [existing] = await db
		.select()
		.from(artifacts)
		.where(eq(artifacts.id, args.id));
	if (!existing) throw new Error("Artifact not found");
	await requireTenantMember(ctx, existing.tenant_id);
	if (i.s3Key !== undefined && i.s3Key !== null) {
		throw new Error("Artifact s3Key is server-managed");
	}

	const nextType = i.type?.toLowerCase() ?? existing.type;
	if (
		typeof i.content === "string" &&
		["applet", "applet_state"].includes(nextType)
	) {
		throw new Error(`${nextType} content must be written through its dedicated resolver`);
	}
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.title !== undefined) updates.title = i.title;
	if (i.type !== undefined) updates.type = nextType;
	if (i.status !== undefined) updates.status = i.status.toLowerCase();
	if (typeof i.content === "string") {
		const contentS3Key = await persistArtifactContentPayload({
			tenantId: existing.tenant_id,
			artifactId: existing.id,
			content: i.content,
			type: nextType,
			revision: randomUUID(),
		});
		updates.content = contentS3Key ? null : i.content;
		if (contentS3Key) updates.s3_key = contentS3Key;
	} else if (i.content === null) {
		updates.content = null;
		if (
			i.s3Key === undefined &&
			artifactContentBelongsInPayloadStore(nextType)
		) {
			updates.s3_key = null;
		}
	}
	if (i.s3Key === null) updates.s3_key = null;
	if (i.summary !== undefined) updates.summary = i.summary;
	if (i.metadata !== undefined)
		updates.metadata = i.metadata ? JSON.parse(i.metadata) : null;
	const [row] = await db
		.update(artifacts)
		.set(updates)
		.where(eq(artifacts.id, args.id))
		.returning();
	if (!row) throw new Error("Artifact not found");
	return artifactToCamelWithPayload(row);
};
