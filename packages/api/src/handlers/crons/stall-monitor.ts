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
import { notifyNewMessage, notifyThreadUpdate } from "../../graphql/notify.js";
import { getRetryDelay } from "../../lib/retry-backoff.js";

const STALL_THRESHOLD_MINUTES = 5;

export async function handler() {
  const db = getDb();
  const now = new Date();

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

  const stalledRunbooks = await reconcileStalledRunbookTasks(db);
  console.log(
    `[stall-monitor] Processed ${processed} stalled turns and ${stalledRunbooks} stalled runbook tasks`,
  );
  return { stalled: processed, stalledRunbooks };
}

async function reconcileStalledRunbookTasks(db: ReturnType<typeof getDb>) {
  const result = await db.execute(sql`
		WITH candidates AS (
			SELECT
				task.id AS task_id,
				task.tenant_id,
				task.title AS task_title,
				run.id AS run_id,
				run.computer_id,
				run.thread_id,
				run.runbook_slug,
				thread.title AS thread_title,
				thread.status AS thread_status,
				COALESCE(task.started_at, task.updated_at, task.created_at) AS stale_since,
				CASE
					WHEN task.details->'supervision'->>'staleAfterMinutes' ~ '^[0-9]+$'
						THEN LEAST(
							GREATEST((task.details->'supervision'->>'staleAfterMinutes')::int, 1),
							120
						)
					ELSE ${STALL_THRESHOLD_MINUTES}::int
				END AS stale_after_minutes
			FROM computer_runbook_tasks task
			JOIN computer_runbook_runs run ON run.id = task.run_id
			LEFT JOIN threads thread ON thread.id = run.thread_id
			WHERE task.status = 'running'
			  AND run.status IN ('queued', 'running')
		)
		SELECT *
		FROM candidates
		WHERE stale_since < NOW() - make_interval(mins => stale_after_minutes)
		LIMIT 25
	`);

  const rows = (result.rows || []) as Array<{
    task_id: string;
    tenant_id: string;
    task_title: string;
    run_id: string;
    computer_id: string;
    thread_id: string | null;
    runbook_slug: string;
    thread_title: string | null;
    thread_status: string | null;
    stale_after_minutes: number;
  }>;
  if (rows.length === 0) return 0;

  console.log(`[stall-monitor] Found ${rows.length} stalled runbook tasks`);
  let processed = 0;
  for (const row of rows) {
    const staleAfterMinutes =
      typeof row.stale_after_minutes === "number"
        ? row.stale_after_minutes
        : Number(row.stale_after_minutes) || STALL_THRESHOLD_MINUTES;
    const message = `Runbook task exceeded the ${staleAfterMinutes} minute execution budget.`;
    await db.execute(sql`
			UPDATE computer_runbook_tasks
			SET
				status = 'failed',
				error = jsonb_build_object(
					'code', 'runbook_step_timed_out',
					'message', ${message}::text,
					'staleAfterMinutes', ${staleAfterMinutes}::int
				),
				completed_at = NOW(),
				updated_at = NOW()
			WHERE id = ${row.task_id}::uuid
			  AND status = 'running'
		`);

    await db.execute(sql`
			UPDATE computer_runbook_tasks
			SET
				status = 'skipped',
				completed_at = NOW(),
				updated_at = NOW()
			WHERE run_id = ${row.run_id}::uuid
			  AND status = 'pending'
		`);

    await db.execute(sql`
			UPDATE computer_runbook_runs
			SET
				status = 'failed',
				error = jsonb_build_object(
					'code', 'runbook_step_timed_out',
					'message', ${message}::text,
					'taskId', ${row.task_id}::text,
					'staleAfterMinutes', ${staleAfterMinutes}::int
				),
				completed_at = NOW(),
				updated_at = NOW()
			WHERE id = ${row.run_id}::uuid
			  AND status IN ('queued', 'running')
		`);

    await db.execute(sql`
			UPDATE computer_tasks
			SET
				status = 'failed',
				error = jsonb_build_object(
					'code', 'runbook_step_timed_out',
					'message', ${message}::text,
					'runbookRunId', ${row.run_id}::text
				),
				completed_at = NOW(),
				updated_at = NOW()
			WHERE tenant_id = ${row.tenant_id}::uuid
			  AND computer_id = ${row.computer_id}::uuid
			  AND task_type = 'runbook_execute'
			  AND status IN ('pending', 'running')
			  AND input->>'runbookRunId' = ${row.run_id}
		`);

    if (row.thread_id) {
      const content = `**Stopped:** ${row.task_title}\n\n${message}`;
      const preview =
        content.length > 240 ? `${content.slice(0, 237)}...` : content;
      const inserted = await db.execute(sql`
				INSERT INTO messages (
					id,
					tenant_id,
					thread_id,
					role,
					content,
					parts,
					sender_type,
					sender_id,
					metadata,
					created_at
				)
				VALUES (
					gen_random_uuid(),
					${row.tenant_id}::uuid,
					${row.thread_id}::uuid,
					'assistant',
					${content}::text,
					jsonb_build_array(
						jsonb_build_object(
							'type', 'text',
							'id', ${`runbook-timeout:${row.run_id}:${row.task_id}`}::text,
							'text', ${content}::text
						)
					),
					'computer',
					${row.computer_id}::uuid,
					jsonb_build_object(
						'runbookMessageKey', ${`runbook-timeout:${row.run_id}:${row.task_id}`}::text,
						'runbookRunId', ${row.run_id}::text,
						'runbookTaskId', ${row.task_id}::text,
						'runbookProgressKind', 'failed',
						'source', 'stall_monitor'
					),
					NOW()
				)
				RETURNING id
			`);
      const messageId = (inserted.rows?.[0] as { id?: string } | undefined)?.id;
      await db.execute(sql`
				UPDATE threads
				SET
					status = 'blocked',
					last_response_preview = ${preview}::text,
					updated_at = NOW()
				WHERE id = ${row.thread_id}::uuid
			`);
      if (messageId) {
        await notifyNewMessage({
          messageId,
          threadId: row.thread_id,
          tenantId: row.tenant_id,
          role: "assistant",
          content,
          senderType: "computer",
          senderId: row.computer_id,
        }).catch(() => {});
      }
      await notifyThreadUpdate({
        threadId: row.thread_id,
        tenantId: row.tenant_id,
        status: "blocked",
        title: row.thread_title ?? "Untitled thread",
      }).catch(() => {});
    }
    processed++;
  }
  return processed;
}
