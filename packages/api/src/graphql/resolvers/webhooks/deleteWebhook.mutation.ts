import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	webhooks,
	threadTurns,
} from "../../utils.js";

export const deleteWebhook = async (_parent: any, args: any, ctx: GraphQLContext) => {
	// Null out webhook_id FK in thread_turns before deleting
	await db
		.update(threadTurns)
		.set({ webhook_id: null })
		.where(eq(threadTurns.webhook_id, args.id));

	// Idempotency records cascade-delete via FK
	await db.delete(webhooks).where(eq(webhooks.id, args.id));

	return true;
};
