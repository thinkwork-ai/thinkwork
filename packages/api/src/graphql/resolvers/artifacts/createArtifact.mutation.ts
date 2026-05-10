import type { GraphQLContext } from "../../context.js";
import {
	db, randomUUID,
	artifacts,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import {
	artifactToCamelWithPayload,
	persistArtifactContentPayload,
} from "./payload.js";

export const createArtifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	await requireTenantMember(ctx, i.tenantId);
	if (i.s3Key !== undefined && i.s3Key !== null) {
		throw new Error("Artifact s3Key is server-managed");
	}
	const id = randomUUID();
	const type = i.type.toLowerCase();
	if (
		typeof i.content === "string" &&
		["applet", "applet_state"].includes(type)
	) {
		throw new Error(`${i.type} content must be written through its dedicated resolver`);
	}
	const contentS3Key =
		typeof i.content === "string"
			? await persistArtifactContentPayload({
					tenantId: i.tenantId,
					artifactId: id,
					content: i.content,
					type,
				})
			: null;
	const [row] = await db
		.insert(artifacts)
		.values({
			id,
			tenant_id: i.tenantId,
			agent_id: i.agentId ?? null,
			thread_id: i.threadId ?? null,
			title: i.title,
			type,
			status: i.status?.toLowerCase() ?? "final",
			content: contentS3Key ? null : (i.content ?? null),
			s3_key: contentS3Key,
			summary: i.summary ?? null,
			source_message_id: i.sourceMessageId ?? null,
			metadata: i.metadata ? JSON.parse(i.metadata) : null,
		})
		.returning();
	return artifactToCamelWithPayload(row);
};
