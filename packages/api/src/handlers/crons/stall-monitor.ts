/**
 * Cron: Stall Monitor (PRD-09 §9.2.4)
 *
 * Detects thread_turns stuck in 'running' for >5 minutes, marks them timed_out,
 * releases thread checkout, and inserts a retry_queue entry with backoff delay.
 *
 * Schedule: every 1 minute
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { getRetryDelay } from "../../lib/retry-backoff.js";
import {
  processStaleMobileHandoffs,
  type ProcessStaleMobileHandoffsDeps,
} from "../../lib/mobile-turns/managed-dispatch.js";

const STALL_THRESHOLD_MINUTES = 5;

export interface StallMonitorDeps {
  processMobileHandoffs(deps?: ProcessStaleMobileHandoffsDeps): Promise<{
    scanned: number;
    claimed: number;
    dispatched: number;
    failed: number;
    skipped: number;
  }>;
}

export async function runStallMonitor(
  deps: StallMonitorDeps = {
    processMobileHandoffs: () => processStaleMobileHandoffs(),
  },
) {
  const db = getDb();
  const now = new Date();
  const mobileHandoffs = await deps.processMobileHandoffs();
  if (
    mobileHandoffs.claimed > 0 ||
    mobileHandoffs.failed > 0 ||
    mobileHandoffs.skipped > 0
  ) {
    console.log(
      `[stall-monitor] Mobile handoffs scanned=${mobileHandoffs.scanned} claimed=${mobileHandoffs.claimed} dispatched=${mobileHandoffs.dispatched} failed=${mobileHandoffs.failed} skipped=${mobileHandoffs.skipped}`,
    );
  }

  // Find turns stuck in 'running' beyond the stall threshold.
  // Uses last_activity_at if set, otherwise falls back to started_at.
  const result = await db.execute(sql`
		SELECT id, tenant_id, agent_id, thread_id, COALESCE(retry_attempt, 0) AS retry_attempt
		FROM thread_turns
		WHERE status = 'running'
		  AND COALESCE(last_activity_at, started_at) < NOW() - INTERVAL '${sql.raw(String(STALL_THRESHOLD_MINUTES))} minutes'
	`);

  const stalledTurns = (result.rows || []) as Array<{
    id: string;
    tenant_id: string;
    agent_id: string;
    thread_id: string | null;
    retry_attempt: number;
  }>;

  if (stalledTurns.length > 0) {
    console.log(`[stall-monitor] Found ${stalledTurns.length} stalled turns`);
  }

  let processed = 0;
  for (const turn of stalledTurns) {
    // Mark the turn as timed_out
    await db.execute(sql`
			UPDATE thread_turns
			SET status = 'timed_out', finished_at = NOW(), error = 'Stall detected: no activity for ${sql.raw(String(STALL_THRESHOLD_MINUTES))} minutes'
			WHERE id = ${turn.id}::uuid AND status = 'running'
		`);

    // Release thread checkout if applicable
    if (turn.thread_id) {
      await db.execute(sql`
				UPDATE threads
				SET checkout_run_id = NULL, updated_at = NOW()
				WHERE id = ${turn.thread_id}::uuid AND checkout_run_id = ${turn.id}
			`);
    }

    // Insert retry_queue entry with backoff delay
    const nextAttempt = (turn.retry_attempt || 0) + 1;
    const delaySec = getRetryDelay(nextAttempt);
    const scheduledAt = new Date(now.getTime() + delaySec * 1000);

    await db.execute(sql`
			INSERT INTO retry_queue (id, tenant_id, agent_id, thread_id, attempt, status, scheduled_at, last_error, origin_turn_id, created_at, updated_at)
			VALUES (
				gen_random_uuid(),
				${turn.tenant_id}::uuid,
				${turn.agent_id}::uuid,
				${turn.thread_id}::uuid,
				${nextAttempt},
				'pending',
				${scheduledAt.toISOString()}::timestamptz,
				'Stall detected after ${sql.raw(String(STALL_THRESHOLD_MINUTES))} minutes',
				${turn.id}::uuid,
				NOW(),
				NOW()
			)
		`);

    processed++;
  }

  console.log(`[stall-monitor] Processed ${processed} stalled turns`);
  return { stalled: processed, mobileHandoffs };
}

export async function handler() {
  return runStallMonitor();
}

// Legacy runbook reconciliation against computer_runbook_tasks /
// computer_runbook_runs was removed alongside the Computer feature kill
// (PR #1666). Those tables never made it into the schema and the cron
// silently failed on "relation does not exist" for months. Future
// Spaces-runbook supervision will need its own implementation.
