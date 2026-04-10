/**
 * Email Triage Scheduler Cron
 *
 * Runs every minute. Checks all agents with `productivityConfig.emailTriageEnabled`
 * in their runtime_config, and enqueues an `email_triage` wakeup request if
 * enough time has passed since the last triage.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { schema } from "@thinkwork/database-pg";

const { agentWakeupRequests } = schema;

const db = getDb();

export async function handler(): Promise<{ enqueued: number }> {
	let enqueued = 0;

	// Find agents with email triage enabled via JSONB query
	const rows = await db.execute(
		sql`SELECT id, tenant_id, runtime_config
		    FROM agents
		    WHERE runtime_config->'productivityConfig'->>'emailTriageEnabled' = 'true'
		      AND status != 'paused'
		      AND (budget_paused IS NULL OR budget_paused = false)`,
	);

	const agents = (rows.rows || []) as Array<{
		id: string;
		tenant_id: string;
		runtime_config: Record<string, unknown>;
	}>;

	for (const agent of agents) {
		const prodConfig = (agent.runtime_config?.productivityConfig || {}) as Record<string, unknown>;
		const intervalMin = (prodConfig.emailTriageIntervalMin as number) || 15;

		// Check if a triage wakeup was already enqueued recently
		const recentCheck = await db.execute(
			sql`SELECT id FROM agent_wakeup_requests
			    WHERE agent_id = ${agent.id}
			      AND reason = 'email_triage'
			      AND status IN ('queued', 'claimed')
			    LIMIT 1`,
		);

		if ((recentCheck.rows || []).length > 0) continue;

		// Check if enough time has passed since last completed triage
		const lastCompleted = await db.execute(
			sql`SELECT finished_at FROM agent_wakeup_requests
			    WHERE agent_id = ${agent.id}
			      AND reason = 'email_triage'
			      AND status = 'completed'
			    ORDER BY finished_at DESC
			    LIMIT 1`,
		);

		const lastFinished = (lastCompleted.rows || [])[0] as { finished_at?: string } | undefined;
		if (lastFinished?.finished_at) {
			const sinceLastMs = Date.now() - new Date(lastFinished.finished_at).getTime();
			if (sinceLastMs < intervalMin * 60 * 1000) continue;
		}

		// Enqueue email triage wakeup
		await db.insert(agentWakeupRequests).values({
			tenant_id: agent.tenant_id,
			agent_id: agent.id,
			source: "email_triage",
			reason: "email_triage",
			status: "queued",
			payload: {},
		});

		enqueued++;
		console.log(`[email-triage-scheduler] Enqueued triage for agent ${agent.id}`);
	}

	if (enqueued > 0) {
		console.log(`[email-triage-scheduler] Enqueued ${enqueued} triage wakeups`);
	}

	return { enqueued };
}
