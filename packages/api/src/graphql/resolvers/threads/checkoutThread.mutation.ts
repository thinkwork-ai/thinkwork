import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, sql,
	threads,
	threadToCamel,
} from "../../utils.js";

export const checkoutThread = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const runId = args.input.runId;
	const [row] = await db
		.update(threads)
		.set({
			checkout_run_id: runId,
			checkout_version: sql`${threads.checkout_version} + 1`,
			updated_at: new Date(),
		})
		.where(
			and(
				eq(threads.id, args.id),
				sql`${threads.checkout_run_id} IS NULL`,
			),
		)
		.returning();
	if (!row) throw new Error("Thread is already checked out or not found");
	return threadToCamel(row);
};
