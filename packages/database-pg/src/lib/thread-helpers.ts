/**
 * Thread creation helper (shared across API + Lambda).
 *
 * ensureThreadForWork() is the single entry point for auto-creating a thread
 * whenever a new unit of work begins (chat, email, scheduled job, etc.).
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { tenants } from "../schema/core";
import { threads } from "../schema/threads";

// ---------------------------------------------------------------------------
// Channel → Prefix mapping
// ---------------------------------------------------------------------------

const CHANNEL_PREFIX: Record<string, string> = {
	schedule: "AUTO",
	email: "EMAIL",
	chat: "CHAT",
	manual: "TICK",
	webhook: "HOOK",
	api: "API",
	task: "TASK",
};

export type ThreadChannel = "chat" | "email" | "schedule" | "manual" | "webhook" | "api" | "task";

interface EnsureThreadOpts {
	tenantId: string;
	agentId?: string;
	userId?: string;
	title?: string;
	channel: ThreadChannel;
}

interface EnsureThreadResult {
	threadId: string;
	identifier: string;
	number: number;
}

export async function ensureThreadForWork(opts: EnsureThreadOpts): Promise<EnsureThreadResult> {
	const db = getDb();
	const channel = opts.channel || "manual";
	const prefix = CHANNEL_PREFIX[channel] || "TICK";

	// Atomic increment of global issue counter
	const [tenant] = await db
		.update(tenants)
		.set({
			issue_counter: sql`${tenants.issue_counter} + 1`,
		})
		.where(eq(tenants.id, opts.tenantId))
		.returning({
			next_number: sql<number>`${tenants.issue_counter}`,
		});

	if (!tenant) throw new Error("Tenant not found");

	const nextNumber = tenant.next_number;
	const identifier = `${prefix}-${nextNumber}`;

	const initialStatus = (channel === "chat" || channel === "schedule") ? "in_progress"
		: channel === "task" ? "todo"
		: "backlog";

	const [thread] = await db
		.insert(threads)
		.values({
			tenant_id: opts.tenantId,
			agent_id: opts.agentId || undefined,
			number: nextNumber,
			identifier,
			title: opts.title || "Untitled conversation",
			status: initialStatus,
			channel,
			assignee_type: opts.agentId ? "agent" : undefined,
			assignee_id: opts.agentId || undefined,
			created_by_type: opts.userId ? "user" : "system",
			created_by_id: opts.userId || undefined,
		})
		.returning({ id: threads.id });

	return { threadId: thread.id, identifier, number: nextNumber };
}
