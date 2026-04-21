/**
 * deleteRun — purge a skill run row for data-subject deletion (plan R11).
 *
 * Tenant-scoped: only an admin of the owning tenant can delete. The row's
 * `delivered_artifact_ref` may point at an S3 object — a future unit adds
 * the DeleteObject cascade; for v1 we delete the row and leave artifact
 * cleanup to the nightly retention sweep.
 *
 * Returns Boolean for ergonomic GraphQL — mutations rarely need the old
 * row after deletion.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	skillRuns,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export class DeleteRunError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeleteRunError";
	}
}

export async function deleteRun(
	_parent: unknown,
	args: { runId: string },
	ctx: GraphQLContext,
): Promise<boolean> {
	const { userId, tenantId } = await resolveCaller(ctx);
	if (!userId || !tenantId) {
		throw new DeleteRunError("unauthorized");
	}

	const [row] = await db
		.select()
		.from(skillRuns)
		.where(and(eq(skillRuns.id, args.runId), eq(skillRuns.tenant_id, tenantId)));
	if (!row) {
		// Opaque 404 — no cross-tenant existence leak.
		throw new DeleteRunError("run not found");
	}

	// v1: invoker can delete their own run. Tenant-admin deletion for
	// another user's run lands when the admin group claim is wired (Unit 7).
	if (row.invoker_user_id !== userId) {
		throw new DeleteRunError("run not found");
	}

	await db.delete(skillRuns).where(eq(skillRuns.id, args.runId));
	return true;
}
