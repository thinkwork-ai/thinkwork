import { randomBytes } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	webhooks,
	snakeToCamel,
} from "../../utils.js";

export const regenerateWebhookToken = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const newToken = randomBytes(32).toString("base64url");

	const [updated] = await db
		.update(webhooks)
		.set({ token: newToken, updated_at: new Date() })
		.where(eq(webhooks.id, args.id))
		.returning();

	return updated ? snakeToCamel(updated) : null;
};
