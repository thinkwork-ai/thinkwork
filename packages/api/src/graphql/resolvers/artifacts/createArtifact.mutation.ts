import type { GraphQLContext } from "../../context.js";
import {
	db,
	artifacts,
	artifactToCamel,
} from "../../utils.js";

export const createArtifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(artifacts)
		.values({
			tenant_id: i.tenantId,
			agent_id: i.agentId ?? null,
			thread_id: i.threadId ?? null,
			title: i.title,
			type: i.type.toLowerCase(),
			status: i.status?.toLowerCase() ?? "final",
			content: i.content ?? null,
			s3_key: i.s3Key ?? null,
			summary: i.summary ?? null,
			source_message_id: i.sourceMessageId ?? null,
			metadata: i.metadata ? JSON.parse(i.metadata) : null,
		})
		.returning();
	return artifactToCamel(row);
};
