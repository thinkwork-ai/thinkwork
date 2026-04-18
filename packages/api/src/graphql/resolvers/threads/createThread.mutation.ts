import type { GraphQLContext } from "../../context.js";
import {
	db, eq, sql,
	agents, tenants, threads,
	threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";

export const createThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;

	// PRD-09 §9.4.4: Agent-created thread validation
	if (i.createdByType === "agent" && i.createdById) {
		const [creatorAgent] = await db
			.select({ tenant_id: agents.tenant_id })
			.from(agents)
			.where(eq(agents.id, i.createdById));
		if (!creatorAgent || creatorAgent.tenant_id !== i.tenantId) {
			throw new Error("Agent can only create threads in its own tenant");
		}
	}

	const channel = (i.channel?.toLowerCase() ?? "manual") as string;
	const CHANNEL_PREFIX: Record<string, string> = {
		schedule: "AUTO", email: "EMAIL", chat: "CHAT",
		manual: "TICK", webhook: "HOOK", api: "API",
	};
	const prefix = CHANNEL_PREFIX[channel] || "TICK";

	const [tenant] = await db
		.update(tenants)
		.set({
			issue_counter: sql`${tenants.issue_counter} + 1`,
		})
		.where(eq(tenants.id, i.tenantId))
		.returning({
			next_number: sql<number>`${tenants.issue_counter}`,
		});
	if (!tenant) throw new Error("Tenant not found");
	const nextNumber = tenant.next_number;
	const identifier = `${prefix}-${nextNumber}`;

	const initialStatus = (channel === "chat" || channel === "schedule") ? "in_progress" : "backlog";

	const [row] = await db
		.insert(threads)
		.values({
			tenant_id: i.tenantId,
			agent_id: i.agentId,
			number: nextNumber,
			identifier,
			title: i.title,
			description: i.description,
			status: initialStatus,
			priority: i.priority?.toLowerCase() ?? "medium",
			type: i.type?.toLowerCase() ?? "task",
			channel,
			parent_id: i.parentId,
			assignee_type: i.assigneeType,
			assignee_id: i.assigneeId,
			billing_code: i.billingCode,
			created_by_type: i.createdByType,
			created_by_id: i.createdById,
			labels: i.labels ? JSON.parse(i.labels) : undefined,
			metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
			due_at: i.dueAt ? new Date(i.dueAt) : undefined,
		})
		.returning();
	notifyThreadUpdate({
		threadId: row.id,
		tenantId: row.tenant_id,
		status: row.status,
		title: row.title,
	}).catch(() => {});

	return { ...threadToCamel(row), commentCount: 0, childCount: 0 };
};
