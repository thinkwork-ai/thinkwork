/**
 * Thread dispatch utilities (PRD-09): blocking check + concurrency enforcement.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const db = getDb();

/**
 * Returns true if a thread is blocked by at least one unresolved dependency
 * (a dependency whose blocker thread is NOT in done/cancelled status).
 */
export async function isThreadBlocked(threadId: string): Promise<boolean> {
	const result = await db.execute(sql`
		SELECT EXISTS (
			SELECT 1 FROM thread_dependencies td
			JOIN threads t ON t.id = td.blocked_by_thread_id
			WHERE td.thread_id = ${threadId}::uuid
			  AND t.status NOT IN ('done', 'cancelled')
		) AS blocked
	`);
	const row = (result.rows || [])[0] as { blocked: boolean } | undefined;
	return row?.blocked === true;
}

/**
 * Check concurrency limits from hive metadata config.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkConcurrencyLimits(
	tenantId: string,
	agentId: string,
): Promise<{ allowed: boolean; reason?: string }> {
	// Look up hive config for this agent's hive
	const hiveResult = await db.execute(sql`
		SELECT h.metadata FROM hives h
		JOIN hive_agents ha ON ha.hive_id = h.id
		WHERE ha.agent_id = ${agentId}::uuid
		LIMIT 1
	`);

	const hiveRow = (hiveResult.rows || [])[0] as { metadata: Record<string, unknown> | null } | undefined;
	const metadata = hiveRow?.metadata;
	if (!metadata) return { allowed: true };

	const concurrency = metadata.concurrency as Record<string, unknown> | undefined;
	if (!concurrency) return { allowed: true };

	const maxPerAgent = concurrency.maxPerAgent as number | undefined;
	const maxConcurrentAgents = concurrency.maxConcurrentAgents as number | undefined;
	const maxByStatus = concurrency.maxByStatus as Record<string, number> | undefined;

	// Count active checkouts for this agent
	if (maxPerAgent !== undefined) {
		const r = await db.execute(sql`
			SELECT COUNT(*)::int AS count FROM threads
			WHERE tenant_id = ${tenantId}::uuid
			  AND assignee_id = ${agentId}::uuid
			  AND checkout_run_id IS NOT NULL
		`);
		const count = ((r.rows || [])[0] as { count: number } | undefined)?.count || 0;
		if (count >= maxPerAgent) {
			return { allowed: false, reason: `agent_limit_reached (${maxPerAgent})` };
		}
	}

	// Count total active agents
	if (maxConcurrentAgents !== undefined) {
		const r = await db.execute(sql`
			SELECT COUNT(DISTINCT assignee_id)::int AS count FROM threads
			WHERE tenant_id = ${tenantId}::uuid
			  AND checkout_run_id IS NOT NULL
		`);
		const count = ((r.rows || [])[0] as { count: number } | undefined)?.count || 0;
		if (count >= maxConcurrentAgents) {
			return { allowed: false, reason: `global_agent_limit_reached (${maxConcurrentAgents})` };
		}
	}

	// Check per-status limits
	if (maxByStatus) {
		for (const [statusKey, limit] of Object.entries(maxByStatus)) {
			const r = await db.execute(sql`
				SELECT COUNT(*)::int AS count FROM threads
				WHERE tenant_id = ${tenantId}::uuid
				  AND status = ${statusKey}
				  AND checkout_run_id IS NOT NULL
			`);
			const count = ((r.rows || [])[0] as { count: number } | undefined)?.count || 0;
			if (count >= limit) {
				return { allowed: false, reason: `status_limit_reached: ${statusKey} (${limit})` };
			}
		}
	}

	return { allowed: true };
}
