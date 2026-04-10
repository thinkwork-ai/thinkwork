import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	threads,
	threadToCamel, assertTransition,
	checkAndFireUnblockWakeups,
} from "../../utils.js";

export const releaseThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { runId, status } = args.input;
	const updates: Record<string, unknown> = {
		checkout_run_id: null,
		updated_at: new Date(),
	};
	if (status) {
		const newStatus = status.toLowerCase();
		// Validate transition before releasing
		const [current] = await db
			.select({ status: threads.status })
			.from(threads)
			.where(eq(threads.id, args.id));
		if (current) assertTransition(current.status, newStatus);
		updates.status = newStatus;
		if (newStatus === "done") {
			updates.completed_at = new Date();
			updates.closed_at = new Date();
		}
		if (newStatus === "cancelled") updates.cancelled_at = new Date();
	}
	const [row] = await db
		.update(threads)
		.set(updates)
		.where(
			and(
				eq(threads.id, args.id),
				eq(threads.checkout_run_id, runId),
			),
		)
		.returning();
	if (!row) throw new Error("Thread not checked out by this run or not found");

	// PRD-09: Auto-unblock dependents when released as done/cancelled
	if (status) {
		const releasedStatus = status.toLowerCase();
		if (releasedStatus === "done" || releasedStatus === "cancelled") {
			await checkAndFireUnblockWakeups(args.id, row.tenant_id);
		}
	}

	return threadToCamel(row);
};
