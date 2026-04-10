import { randomBytes } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import {
	db,
	webhooks,
	snakeToCamel,
} from "../../utils.js";

export const createWebhook = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const token = randomBytes(32).toString("base64url");

	const [row] = await db
		.insert(webhooks)
		.values({
			tenant_id: i.tenantId,
			name: i.name,
			description: i.description || null,
			token,
			target_type: i.targetType,
			agent_id: i.agentId || null,
			routine_id: i.routineId || null,
			prompt: i.prompt || null,
			config: i.config ? JSON.parse(i.config) : null,
			enabled: true,
			rate_limit: i.rateLimit || 60,
			created_by_type: "user",
		})
		.returning();

	return snakeToCamel(row);
};
