import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agents, agentCapabilities, snakeToCamel } from "../../utils.js";

export async function toggleAgentEmailChannel(_parent: any, args: any, ctx: GraphQLContext) {
	let [cap] = await db
		.select()
		.from(agentCapabilities)
		.where(
			and(
				eq(agentCapabilities.agent_id, args.agentId),
				eq(agentCapabilities.capability, "email_channel"),
			),
		);
	if (!cap) {
		// Auto-provision the email capability row for older agents
		const [agent] = await db.select().from(agents).where(eq(agents.id, args.agentId));
		if (!agent) throw new Error("Agent not found");
		[cap] = await db
			.insert(agentCapabilities)
			.values({
				agent_id: args.agentId,
				tenant_id: agent.tenant_id,
				capability: "email_channel",
				config: {
					emailAddress: `${agent.slug}@agents.thinkwork.ai`,
					allowedSenders: [],
					replyTokensEnabled: true,
					maxReplyTokenAgeDays: 7,
					maxReplyTokenUses: 3,
					rateLimitPerHour: 50,
				},
				enabled: args.enabled as boolean,
			})
			.returning();
		return snakeToCamel(cap);
	}
	const [updated] = await db
		.update(agentCapabilities)
		.set({ enabled: args.enabled as boolean })
		.where(eq(agentCapabilities.id, cap.id))
		.returning();
	return snakeToCamel(updated);
}
