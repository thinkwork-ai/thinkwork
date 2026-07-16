/**
 * Cron: Retry Dispatcher (PRD-09 §9.2.5, THINK-307)
 *
 * Claims pending retries where scheduled_at <= now() and dispatches an
 * agent_wakeup_request (source 'automation' / reason 'retry') — but only when
 * the origin turn genuinely needs recovery. Guard chain (THINK-307 KTD4),
 * evaluated per claimed row in order:
 *
 *   1. Backlog cutoff — scheduled_at older than 60 minutes → superseded.
 *      The retry backoff cap is 300s, so no legitimate retry is scheduled
 *      that far out; this makes first-enable on a stage with stale backlog
 *      inert (rows drain as superseded records, zero prompts re-run).
 *   2. Origin state — origin turn succeeded or cancelled → superseded.
 *   3. Successor — an attempt turn already exists for the origin (e.g. a
 *      manual Retry raced the queue) → superseded.
 *   4. Freshness — origin still running with activity fresher than
 *      STALL_THRESHOLD_MINUTES (same knob as the stall monitor) → superseded.
 *   5. Exhaustion — attempt >= max_attempts → exhausted (pre-existing).
 *   6. Dispatch — wakeup insert; row stays dispatched (pre-existing).
 *
 * Schedule: every 1 minute (Terraform aws_scheduler_schedule.retry_dispatcher,
 * state driven by var.retry_dispatcher_enabled).
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const BATCH_SIZE = 20;
const BACKLOG_CUTOFF_MINUTES = 60;
const DEFAULT_STALL_THRESHOLD_MINUTES = 5;

/**
 * One operational knob shared with the stall monitor (THINK-306): the same
 * threshold decides both "this turn stalled" and "this turn recovered". Read
 * per invocation (not at module load) so env changes land without a cold
 * start and tests can vary it.
 */
function resolveStallThresholdMinutes(): number {
  const raw = process.env.STALL_THRESHOLD_MINUTES;
  if (!raw) return DEFAULT_STALL_THRESHOLD_MINUTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_STALL_THRESHOLD_MINUTES;
  }
  return parsed;
}

export async function handler() {
  const db = getDb();
  const stallThresholdMinutes = resolveStallThresholdMinutes();

  // Claim pending retries that are due. Claiming stays a single CAS UPDATE
  // (KTD5); guards below re-mark guard-hit rows superseded/exhausted.
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
		RETURNING id, tenant_id, agent_id, thread_id, attempt, max_attempts, origin_turn_id, scheduled_at
	`);

  const pending = (result.rows || []) as Array<{
    id: string;
    tenant_id: string;
    agent_id: string;
    thread_id: string | null;
    attempt: number;
    max_attempts: number;
    origin_turn_id: string | null;
    scheduled_at: string | Date;
  }>;

  if (pending.length === 0) {
    return { dispatched: 0, exhausted: 0, superseded: 0 };
  }

  let dispatched = 0;
  let exhausted = 0;
  let superseded = 0;

  const supersede = async (retryId: string, reason: string) => {
    await db.execute(sql`
			UPDATE retry_queue SET status = 'superseded', updated_at = NOW() WHERE id = ${retryId}::uuid
		`);
    console.log(`[retry-dispatcher] Superseded ${retryId}: ${reason}`);
    superseded++;
  };

  const now = Date.now();

  for (const retry of pending) {
    // Guard 1 (R4): stale backlog — no origin lookup needed.
    const scheduledAtMs = new Date(retry.scheduled_at).getTime();
    if (
      Number.isFinite(scheduledAtMs) &&
      now - scheduledAtMs > BACKLOG_CUTOFF_MINUTES * 60_000
    ) {
      await supersede(
        retry.id,
        `scheduled_at older than ${BACKLOG_CUTOFF_MINUTES} minutes (stale backlog)`,
      );
      continue;
    }

    // Guards 2–4 (R2/R3 + successor): one origin-turn lookup per row.
    // Rows with no origin turn skip these (nothing to consult) and rely on
    // the backlog guard + exhaustion check.
    if (retry.origin_turn_id) {
      const originResult = await db.execute(sql`
				SELECT
					status,
					(status = 'running' AND COALESCE(last_activity_at, started_at) > NOW() - make_interval(mins => ${stallThresholdMinutes})) AS fresh,
					EXISTS (
						SELECT 1 FROM thread_turns successor
						WHERE successor.origin_turn_id = ${retry.origin_turn_id}::uuid
					) AS has_successor
				FROM thread_turns
				WHERE id = ${retry.origin_turn_id}::uuid
			`);
      const origin = (originResult.rows || [])[0] as
        | { status: string; fresh: boolean; has_successor: boolean }
        | undefined;

      if (origin) {
        if (origin.status === "succeeded" || origin.status === "cancelled") {
          await supersede(
            retry.id,
            `origin turn ${retry.origin_turn_id} is ${origin.status} — no recovery needed`,
          );
          continue;
        }
        if (origin.has_successor) {
          await supersede(
            retry.id,
            `origin turn ${retry.origin_turn_id} already has a successor attempt turn`,
          );
          continue;
        }
        if (origin.fresh) {
          await supersede(
            retry.id,
            `origin turn ${retry.origin_turn_id} is running with activity fresher than ${stallThresholdMinutes} minutes`,
          );
          continue;
        }
      }
    }

    // Guard 5: max attempts reached — mark exhausted. Runs only for rows
    // that still want dispatch, so stale/recovered rows end superseded, not
    // exhausted (keeps the status truthful for the recovery surface).
    if (retry.attempt >= retry.max_attempts) {
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

  console.log(
    `[retry-dispatcher] Dispatched ${dispatched}, exhausted ${exhausted}, superseded ${superseded}`,
  );
  return { dispatched, exhausted, superseded };
}
