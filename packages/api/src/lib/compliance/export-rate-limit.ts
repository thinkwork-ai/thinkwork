/**
 * Per-actor rate limit on createComplianceExport.
 *
 * Hard cap: 10 exports / hour / actor_id. Implemented as a single
 * indexed COUNT(*) query against compliance.export_jobs with a
 * 1-hour rolling window. No Redis dependency at v1 — operator scale
 * is one-digit and the existing `idx_export_jobs_actor_requested`
 * index serves the lookup.
 *
 * The check fires *before* the INSERT, not in a transaction. A race
 * could let the 11th request slip through under concurrent load —
 * accepted tradeoff at v1 (operators don't fire concurrent exports
 * faster than 11 per second). If concurrent abuse becomes a concern,
 * promote the count to a row-level advisory lock keyed on actor_id.
 */

export interface ExportRateLimitResult {
	allowed: boolean;
	current: number;
	limit: number;
	windowSeconds: number;
}

export const EXPORT_RATE_LIMIT_PER_HOUR = 10;
const WINDOW_SECONDS = 60 * 60;

interface PgQueryClient {
	query: (
		sql: string,
		values: unknown[],
	) => Promise<{ rows: unknown[] }>;
}

/**
 * Count exports the given actor has requested in the last hour and
 * decide whether the next request should be admitted.
 *
 * The query intentionally counts *all* statuses (queued, running,
 * complete, failed) — a failed export still consumed the rate-limit
 * slot. This prevents a hostile or buggy caller from looping
 * fail-fast jobs to bypass the cap.
 */
export async function checkExportRateLimit(
	client: PgQueryClient,
	actorId: string,
): Promise<ExportRateLimitResult> {
	const res = await client.query(
		`SELECT count(*)::int AS n
		   FROM compliance.export_jobs
		  WHERE requested_by_actor_id = $1::uuid
		    AND requested_at > now() - INTERVAL '1 hour'`,
		[actorId],
	);
	const rows = res.rows as { n: number }[];
	const current = rows[0]?.n ?? 0;
	return {
		allowed: current < EXPORT_RATE_LIMIT_PER_HOUR,
		current,
		limit: EXPORT_RATE_LIMIT_PER_HOUR,
		windowSeconds: WINDOW_SECONDS,
	};
}
