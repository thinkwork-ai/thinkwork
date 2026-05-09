import type { GraphQLContext } from "../../context.js";
import {
	db,
	inboxItems,
	inboxItemToCamel,
	recordActivity,
} from "../../utils.js";
import { sendComputerApprovalPush } from "../../../lib/push-notifications.js";

interface CreatedInboxItemRow {
	id: string;
	tenant_id: string;
	recipient_id?: string | null;
	type: string;
	title?: string | null;
	description?: string | null;
	config?: unknown;
}

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
	await notifyComputerApprovalCreated(row);
	return inboxItemToCamel(row);
};

export async function notifyComputerApprovalCreated(row: CreatedInboxItemRow): Promise<void> {
	if (row.type !== "computer_approval" || !row.recipient_id) return;

	try {
		await sendComputerApprovalPush({
			userId: row.recipient_id,
			tenantId: row.tenant_id,
			approvalId: row.id,
			question: computerApprovalPushQuestion(row),
		});
	} catch (err) {
		console.error("[createInboxItem] computer approval push failed:", err);
	}
}

export function computerApprovalPushQuestion(
	row: Pick<CreatedInboxItemRow, "title" | "description" | "config">,
): string {
	const config = parseRecord(row.config);
	return (
		textValue(config.question) ||
		textValue(config.questionText) ||
		row.title?.trim() ||
		textValue(config.actionDescription) ||
		textValue(config.action_description) ||
		textValue(config.description) ||
		row.description?.trim() ||
		"Approval needed"
	);
}

function parseRecord(value: unknown): Record<string, unknown> {
	if (!value) return {};
	if (typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== "string") return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function textValue(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
