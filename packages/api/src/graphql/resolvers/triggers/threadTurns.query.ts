import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, sql, inArray,
	scheduledJobs, threadTurns, costEvents,
	snakeToCamel,
} from "../../utils.js";

export const threadTurns_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions = [eq(threadTurns.tenant_id, args.tenantId)];
	if (args.agentId) conditions.push(eq(threadTurns.agent_id, args.agentId));
	if (args.routineId) conditions.push(eq(threadTurns.routine_id, args.routineId));
	if (args.threadId) conditions.push(eq(threadTurns.thread_id, args.threadId));
	if (args.jobId) conditions.push(eq(threadTurns.job_id, args.jobId));
	if (args.status) conditions.push(eq(threadTurns.status, args.status.toLowerCase()));
	const limit = Math.min(args.limit || 50, 200);
	const rows = await db
		.select({
			id: threadTurns.id,
			tenant_id: threadTurns.tenant_id,
			trigger_id: threadTurns.trigger_id,
			agent_id: threadTurns.agent_id,
			thread_id: threadTurns.thread_id,
			routine_id: threadTurns.routine_id,
			invocation_source: threadTurns.invocation_source,
			trigger_detail: threadTurns.trigger_detail,
			wakeup_request_id: threadTurns.wakeup_request_id,
			status: threadTurns.status,
			started_at: threadTurns.started_at,
			finished_at: threadTurns.finished_at,
			error: threadTurns.error,
			error_code: threadTurns.error_code,
			usage_json: threadTurns.usage_json,
			result_json: threadTurns.result_json,
			context_snapshot: threadTurns.context_snapshot,
			session_id_before: threadTurns.session_id_before,
			session_id_after: threadTurns.session_id_after,
			external_run_id: threadTurns.external_run_id,
			log_store: threadTurns.log_store,
			log_ref: threadTurns.log_ref,
			log_bytes: threadTurns.log_bytes,
			log_sha256: threadTurns.log_sha256,
			log_compressed: threadTurns.log_compressed,
			stdout_excerpt: threadTurns.stdout_excerpt,
			stderr_excerpt: threadTurns.stderr_excerpt,
			created_at: threadTurns.created_at,
			trigger_name: scheduledJobs.name,
		})
		.from(threadTurns)
		.leftJoin(scheduledJobs, eq(threadTurns.trigger_id, scheduledJobs.id))
		.where(and(...conditions))
		.orderBy(desc(threadTurns.started_at))
		.limit(limit);

	// Batch-resolve totalCost per trigger run from cost_events
	const wakeupIds = rows.map((r) => r.wakeup_request_id).filter(Boolean) as string[];
	const runCostMap = new Map<string, number>();
	if (wakeupIds.length > 0) {
		try {
			const costRows = await db
				.select({
					request_id: costEvents.request_id,
					total: sql<string>`COALESCE(SUM(amount_usd), 0)`,
				})
				.from(costEvents)
				.where(inArray(costEvents.request_id, wakeupIds))
				.groupBy(costEvents.request_id);
			for (const row of costRows) {
				runCostMap.set(row.request_id, Number(row.total));
			}
		} catch (costErr) {
			console.error("[graphql] TriggerRun cost batch failed:", costErr);
		}
	}

	return rows.map((r) => ({
		...snakeToCamel(r),
		totalCost: r.wakeup_request_id ? (runCostMap.get(r.wakeup_request_id) ?? null) : null,
	}));
};
