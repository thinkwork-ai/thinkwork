/**
 * Cron: Retry Dispatcher (PRD-09 §9.2.5)
 *
 * Claims pending retries where scheduled_at <= now(), checks max_attempts,
 * and enqueues agent_wakeup_request with source 'automation' / reason 'retry'.
 *
 * Schedule: every 1 minute
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const BATCH_SIZE = 20;

export async function handler() {
	const db = getDb();

	// Claim pending retries that are due
	const result = await db.execute(sql`
		UPDATE retry_queue
		SET status = 'dispatched', updated_at = NOW()
		WHERE id IN (
			SELECT id FROM retry_queue
			WHERE status = 'pending'
			  AND scheduled_at <= NOW()
			ORDER BY scheduled_at ASC
			LIMIT ${BATCH_SIZE}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, tenant_id, agent_id, thread_id, attempt, max_attempts, origin_turn_id
	`);

	const pending = (result.rows || []) as Array<{
		id: string;
		tenant_id: string;
		agent_id: string;
		thread_id: string | null;
		attempt: number;
		max_attempts: number;
		origin_turn_id: string | null;
	}>;

	if (pending.length === 0) return { dispatched: 0, exhausted: 0 };

	let dispatched = 0;
	let exhausted = 0;

	for (const retry of pending) {
		if (retry.attempt >= retry.max_attempts) {
			// Max attempts reached — mark exhausted
			await db.execute(sql`
				UPDATE retry_queue SET status = 'exhausted', updated_at = NOW() WHERE id = ${retry.id}::uuid
			`);
			exhausted++;
			continue;
		}

		// Enqueue wakeup request for retry
		await db.execute(sql`
			INSERT INTO agent_wakeup_requests (id, tenant_id, agent_id, source, reason, trigger_detail, payload, status, requested_by_actor_type, created_at)
			VALUES (
				gen_random_uuid(),
				${retry.tenant_id}::uuid,
				${retry.agent_id}::uuid,
				'automation',
				'retry',
				${retry.thread_id ? `thread:${retry.thread_id}` : null},
				${JSON.stringify({
					threadId: retry.thread_id,
					retryAttempt: retry.attempt,
					originTurnId: retry.origin_turn_id,
				})}::jsonb,
				'queued',
				'system',
				NOW()
			)
		`);

		dispatched++;
	}

	console.log(`[retry-dispatcher] Dispatched ${dispatched}, exhausted ${exhausted}`);
	return { dispatched, exhausted };
}
