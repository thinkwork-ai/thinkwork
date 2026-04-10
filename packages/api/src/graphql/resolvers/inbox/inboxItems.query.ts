import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc,
	inboxItems,
	inboxItemToCamel,
} from "../../utils.js";

export const inboxItems_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(inboxItems.tenant_id, args.tenantId)];
	if (args.status) conditions.push(eq(inboxItems.status, args.status.toLowerCase()));
	if (args.entityType) conditions.push(eq(inboxItems.entity_type, args.entityType));
	if (args.entityId) conditions.push(eq(inboxItems.entity_id, args.entityId));
	if (args.recipientId) conditions.push(eq(inboxItems.recipient_id, args.recipientId));
	const rows = await db.select().from(inboxItems).where(and(...conditions)).orderBy(desc(inboxItems.created_at));
	return rows.map(inboxItemToCamel);
};
