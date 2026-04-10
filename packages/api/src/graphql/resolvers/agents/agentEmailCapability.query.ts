import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agentCapabilities } from "../../utils.js";

export async function agentEmailCapability(_parent: any, args: any, ctx: GraphQLContext) {
	const [cap] = await db
		.select()
		.from(agentCapabilities)
		.where(
			and(
				eq(agentCapabilities.agent_id, args.agentId),
				eq(agentCapabilities.capability, "email_channel"),
			),
		);
	if (!cap) return null;
	const config = (cap.config as Record<string, unknown>) || {};
	return {
		id: cap.id,
		agentId: cap.agent_id,
		enabled: cap.enabled,
		emailAddress: config.emailAddress || null,
		vanityAddress: config.vanityAddress || null,
		allowedSenders: config.allowedSenders || [],
		replyTokensEnabled: config.replyTokensEnabled ?? true,
		maxReplyTokenAgeDays: config.maxReplyTokenAgeDays ?? 7,
		maxReplyTokenUses: config.maxReplyTokenUses ?? 3,
		rateLimitPerHour: config.rateLimitPerHour ?? 50,
	};
}
