import type { GraphQLContext } from "../../context.js";
import {
	db,
	inboxItems,
	inboxItemToCamel,
	recordActivity,
} from "../../utils.js";

export const createInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [row] = await db
		.insert(inboxItems)
		.values({
			tenant_id: i.tenantId,
			requester_type: i.requesterType,
			requester_id: i.requesterId,
			recipient_id: i.recipientId,
			type: i.type,
			title: i.title,
			description: i.description,
			entity_type: i.entityType,
			entity_id: i.entityId,
			config: i.config ? JSON.parse(i.config) : undefined,
			expires_at: i.expiresAt ? new Date(i.expiresAt) : undefined,
		})
		.returning();
	await recordActivity(
		row.tenant_id, i.requesterType ?? "system", i.requesterId ?? row.id,
		"inbox_item.created", "inbox_item", row.id,
		{ type: i.type, title: i.title },
	);
	return inboxItemToCamel(row);
};
