/**
 * cancelSkillRun — flip a running composition to `cancelled`.
 *
 * The composition_runner checks `skill_runs.status` between steps (plan
 * D3) and aborts when it observes `cancelled`. This resolver just writes
 * the status and returns the row — the runner's cooperative check is what
 * actually stops the work.
 *
 * Authz: only the invoker or a tenant admin can cancel. Cross-tenant
 * cancellation returns 404 (not 403) to avoid leaking existence.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	skillRuns,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export class CancelSkillRunError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CancelSkillRunError";
	}
}

export async function cancelSkillRun(
	_parent: unknown,
	args: { runId: string },
	ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
	const { userId, tenantId } = await resolveCaller(ctx);
	if (!userId || !tenantId) {
		throw new CancelSkillRunError("unauthorized");
	}

	const [row] = await db
		.select()
		.from(skillRuns)
		.where(and(eq(skillRuns.id, args.runId), eq(skillRuns.tenant_id, tenantId)));

	if (!row) {
		throw new CancelSkillRunError("run not found");
	}
	if (row.invoker_user_id !== userId) {
		// Defer tenant-admin check to Unit 7 when the admin group claim lands.
		// For now only the invoker can cancel — match the row-absent error so
		// we don't leak run existence to non-owners.
		throw new CancelSkillRunError("run not found");
	}

	if (row.status !== "running") {
		// Idempotent: already terminal, return as-is.
		return snakeToCamel(row as Record<string, unknown>);
	}

	const [cancelled] = await db
		.update(skillRuns)
		.set({
			status: "cancelled",
			finished_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(skillRuns.id, args.runId))
		.returning();

	return snakeToCamel((cancelled ?? row) as Record<string, unknown>);
}
