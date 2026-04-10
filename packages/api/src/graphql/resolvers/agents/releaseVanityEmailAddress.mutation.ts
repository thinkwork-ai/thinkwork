import type { GraphQLContext } from "../../context.js";
import { db, eq, and, agentCapabilities, snakeToCamel } from "../../utils.js";

export async function releaseVanityEmailAddress(_parent: any, args: any, ctx: GraphQLContext) {
	const [cap] = await db
		.select()
		.from(agentCapabilities)
		.where(
			and(
				eq(agentCapabilities.agent_id, args.agentId),
				eq(agentCapabilities.capability, "email_channel"),
			),
		);
	if (!cap) throw new Error("Email capability not found");

	const releaseConfig = (cap.config as Record<string, unknown>) || {};
	const { vanityAddress: _removed, ...restConfig } = releaseConfig;
	const [updated] = await db
		.update(agentCapabilities)
		.set({ config: { ...restConfig, vanityAddress: null } })
		.where(eq(agentCapabilities.id, cap.id))
		.returning();
	return snakeToCamel(updated);
}
