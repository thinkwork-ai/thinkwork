import type { GraphQLContext } from "../../context.js";
import { db, eq, threads, threadToCamel } from "../../utils.js";
import { syncExternalTaskOnCreate } from "../../../integrations/external-work-items/syncExternalTaskOnCreate.js";

/**
 * Re-fire the outbound sync for a task-channel thread that failed its
 * initial sync attempt (sync_status='error') or was created before the
 * external API was available (sync_status='local').
 *
 * Idempotency: `syncExternalTaskOnCreate` uses a deterministic idempotency
 * key keyed on the thread id, so LastMile (when it honors the header)
 * will return the same external task id on retry instead of creating a
 * duplicate. Rows that are already 'synced' short-circuit to a no-op to
 * guard against accidental double-pushes.
 */
export const retryTaskSync = async (
	_parent: any,
	args: { threadId: string },
	_ctx: GraphQLContext,
) => {
	const { threadId } = args;

	const [row] = await db
		.select()
		.from(threads)
		.where(eq(threads.id, threadId));
	if (!row) throw new Error("Thread not found");

	if (row.channel !== "task") {
		throw new Error(`retryTaskSync is only valid for task-channel threads (got channel='${row.channel}')`);
	}

	// Already good — nothing to retry. Returning the row rather than
	// throwing lets the mobile client call this optimistically after
	// a reload without having to check state first.
	if (row.sync_status === "synced") {
		return { ...threadToCamel(row), commentCount: 0, childCount: 0 };
	}

	if (!row.created_by_id) {
		throw new Error("Thread has no created_by_id — cannot resolve task connector for retry");
	}

	await syncExternalTaskOnCreate({
		threadId: row.id,
		tenantId: row.tenant_id,
		userId: row.created_by_id,
		title: row.title,
		description: row.description,
		externalRef: row.identifier ?? undefined,
	});

	// Re-read the reconciled row so the response reflects the new
	// sync_status — matches the createThread resolver pattern.
	const [reconciled] = await db
		.select()
		.from(threads)
		.where(eq(threads.id, threadId));
	if (!reconciled) throw new Error("Thread disappeared during retry");
	return { ...threadToCamel(reconciled), commentCount: 0, childCount: 0 };
};
