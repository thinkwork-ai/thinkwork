/**
 * skill-runs-reconciler Lambda
 *
 * Runs on a 5-minute EventBridge schedule. Transitions skill_runs rows
 * that have been stuck at status='running' for more than 15 minutes into
 * status='failed' with a reconciler-sourced failure_reason.
 *
 * Why: when the agentcore Lambda OOMs, times out, or crashes mid
 * run_composition, the TS API never receives the terminal-state writeback
 * from /api/skills/complete. Without a reconciler, those rows sit at
 * 'running' forever — dedup logic treats them as active and blocks new
 * runs of the same (tenant, invoker, skill, inputs) key.
 *
 * Logs one structured line per reconciled row so CloudWatch Logs Insights
 * can alert on sustained agentcore failures, plus a summary line with the
 * total count.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

const { skillRuns } = schema;

const STALE_AFTER_MINUTES = 15;

const FAILURE_REASON = `reconciler: stale running row (no terminal writeback within ${STALE_AFTER_MINUTES} min)`;

export async function handler(): Promise<{ reconciled: number }> {
	const db = getDb();
	const start = Date.now();

	const reconciled = await db
		.update(skillRuns)
		.set({
			status: "failed",
			failure_reason: FAILURE_REASON,
			finished_at: new Date(),
			updated_at: new Date(),
		})
		.where(
			and(
				eq(skillRuns.status, "running"),
				lt(
					skillRuns.started_at,
					sql`now() - (${STALE_AFTER_MINUTES} || ' minutes')::interval`,
				),
			),
		)
		.returning({
			id: skillRuns.id,
			tenant_id: skillRuns.tenant_id,
			skill_id: skillRuns.skill_id,
			started_at: skillRuns.started_at,
		});

	for (const row of reconciled) {
		const ageMs = Date.now() - new Date(row.started_at).getTime();
		console.log(
			`[skill-runs-reconciler] row_reconciled run_id=${row.id} tenant_id=${row.tenant_id} skill_id=${row.skill_id} age_ms=${ageMs}`,
		);
	}

	const duration = Date.now() - start;
	console.log(
		`[skill-runs-reconciler] reconciled=${reconciled.length} stale_after_min=${STALE_AFTER_MINUTES} duration_ms=${duration}`,
	);

	return { reconciled: reconciled.length };
}
