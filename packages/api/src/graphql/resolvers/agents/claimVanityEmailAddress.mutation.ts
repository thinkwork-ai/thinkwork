import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agents, agentCapabilities, snakeToCamel } from "../../utils.js";

export async function claimVanityEmailAddress(_parent: any, args: any, ctx: GraphQLContext) {
	const localPart = (args.localPart as string).toLowerCase();

	// Validate: 3-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens
	if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(localPart)) {
		throw new Error("Invalid vanity address: must be 3-30 characters, lowercase alphanumeric and hyphens, no leading/trailing hyphens");
	}

	// Check it's not already an agent slug
	const [existingAgent] = await db
		.select({ id: agents.id })
		.from(agents)
		.where(eq(agents.slug, localPart));
	if (existingAgent) {
		throw new Error("This address is already taken (matches an existing agent slug)");
	}

	// Look up or auto-provision email capability
	let [cap] = await db
		.select()
		.from(agentCapabilities)
		.where(
			and(
				eq(agentCapabilities.agent_id, args.agentId),
				eq(agentCapabilities.capability, "email_channel"),
			),
		);
	try {
		if (!cap) {
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
						vanityAddress: localPart,
						allowedSenders: [],
						replyTokensEnabled: true,
						maxReplyTokenAgeDays: 7,
						maxReplyTokenUses: 3,
						rateLimitPerHour: 50,
					},
					enabled: true,
				})
				.returning();
			return snakeToCamel(cap);
		}

		// Update config with vanity address — unique index will reject duplicates
		const claimConfig = (cap.config as Record<string, unknown>) || {};
		const [updated] = await db
			.update(agentCapabilities)
			.set({
				config: { ...claimConfig, vanityAddress: localPart },
			})
			.where(eq(agentCapabilities.id, cap.id))
			.returning();
		return snakeToCamel(updated);
	} catch (err: unknown) {
		if (err instanceof Error && (err.message.includes("idx_unique_vanity_email") || err.message.includes("unique"))) {
			throw new Error("This address is already taken");
		}
		throw err;
	}
}
