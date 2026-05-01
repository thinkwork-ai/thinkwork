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
import { requireTenantMember } from "../core/authz.js";
import {
	bridgeInboxDecisionToRoutineApproval,
	isRoutineApprovalInboxItem,
} from "./routine-approval-bridge.js";

export const decideInboxItem = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [current] = await db.select().from(inboxItems).where(eq(inboxItems.id, args.id));
	if (!current) throw new Error("Inbox item not found");
	// Tenant gate against the row's own tenant — pre-U8 this resolver had
	// a cross-tenant IDOR (caller could decide any inbox item by id). U8
	// dispatches to the routine-approval bridge which calls SFN
	// SendTaskSuccess on attacker-controlled decisionValues, so the
	// missing gate is a P0 there.
	await requireTenantMember(ctx, current.tenant_id);
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
	if (
		isRoutineApprovalInboxItem(current) &&
		(targetStatus === "approved" || targetStatus === "rejected")
	) {
		// AWSJSON arrives as a JSON string on the wire. Parse to a
		// Record for the bridge; bad JSON throws a typed error rather
		// than poisoning the SFN payload silently.
		let parsedValues: Record<string, unknown> | undefined;
		if (typeof i.decisionValues === "string" && i.decisionValues.length > 0) {
			try {
				parsedValues = JSON.parse(i.decisionValues);
			} catch (err) {
				throw new Error(
					`decisionValues is not valid JSON: ${(err as Error).message}`,
				);
			}
		}
		await bridgeInboxDecisionToRoutineApproval({
			inboxItem: current,
			decision: targetStatus as "approved" | "rejected",
			actorId: decidedBy,
			decisionPayload: {
				reviewNotes: i.comment ?? null,
				values: parsedValues,
			},
		});
	}
	await recordActivity(
		row.tenant_id, "user", decidedBy ?? row.id,
		`inbox_item.${targetStatus}`, "inbox_item", row.id,
	);
	return inboxItemToCamel(row);
};
