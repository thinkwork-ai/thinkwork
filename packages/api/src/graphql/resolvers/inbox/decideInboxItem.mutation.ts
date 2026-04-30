import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	inboxItems, inboxItemComments,
	inboxItemToCamel, assertInboxItemTransition,
	recordActivity,
} from "../../utils.js";
import {
	applyBrainEnrichmentInboxItem,
	closeBrainEnrichmentReviewThread,
} from "../../../lib/brain/enrichment-apply.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export const decideInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	const targetStatus = i.status.toLowerCase();
	assertInboxItemTransition(current.status, targetStatus);
	const decidedBy = await resolveCallerUserId(ctx);
	const updates: Record<string, unknown> = {
		status: targetStatus,
		decided_by: decidedBy,
		decided_at: new Date(),
		updated_at: new Date(),
	};
	const [row] = await db.update(inboxItems).set(updates).where(eq(inboxItems.id, args.id)).returning();
	if (i.comment) {
		await db.insert(inboxItemComments).values({
			inbox_item_id: args.id,
			tenant_id: row.tenant_id,
			content: i.comment,
			author_type: "user",
			author_id: decidedBy ?? undefined,
		});
	}
	if (current.type === "brain_enrichment_proposal") {
		if (targetStatus === "approved") {
			await applyBrainEnrichmentInboxItem({
				inboxItemId: row.id,
				reviewerId: decidedBy,
			});
		} else if (targetStatus === "rejected" || targetStatus === "revision_requested") {
			await closeBrainEnrichmentReviewThread({
				inboxItemId: row.id,
				reviewerId: decidedBy,
				status: targetStatus,
			});
		}
	}
	await recordActivity(
		row.tenant_id, "user", decidedBy ?? row.id,
		`inbox_item.${targetStatus}`, "inbox_item", row.id,
	);
	return inboxItemToCamel(row);
};
