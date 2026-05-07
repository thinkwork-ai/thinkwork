import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	agents, scheduledJobs,
	invokeJobScheduleManager,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";

export async function deleteAgent(_parent: any, args: any, ctx: GraphQLContext) {
	// Compliance audit actor: branch by auth path. Apikey callers
	// identify as `system` with a stable platform-credential constant
	// (the x-principal-id header is unverified per
	// packages/api/src/lib/tenant-membership.ts:112-114). Cognito callers
	// identify as `user` with the resolved users.id, falling back to the
	// cognito sub when the users-lookup misses.
	const auditActor: { actorId: string; actorType: "user" | "system" } =
		ctx.auth.authType === "apikey"
			? { actorId: "platform-credential", actorType: "system" }
			: await (async () => {
				const { userId } = await resolveCaller(ctx);
				return {
					actorId: userId ?? ctx.auth.principalId ?? "unknown",
					actorType: "user" as const,
				};
			})();

	// Wrap the soft-delete + audit emit in a single transaction so
	// audit-write failure rolls back the status change
	// (control-evidence tier per master plan U5).
	const [row] = await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(agents)
			.set({ status: "archived", updated_at: new Date() })
			.where(eq(agents.id, args.id))
			.returning({
				id: agents.id,
				tenant_id: agents.tenant_id,
				status: agents.status,
			});
		if (!updated) return [];

		await emitAuditEvent(tx, {
			tenantId: updated.tenant_id,
			actorId: auditActor.actorId,
			actorType: auditActor.actorType,
			eventType: "agent.deleted",
			source: "graphql",
			payload: {
				agentId: updated.id,
				reason: "admin_archive",
			},
			resourceType: "agent",
			resourceId: updated.id,
			action: "delete",
			outcome: "success",
		});

		return [updated];
	});

	// Clean up triggers for this agent (best-effort, outside the audit tx
	// so an unrelated scheduler failure doesn't roll back the archive).
	if (row) {
		const agentJobs = await db
			.select({ id: scheduledJobs.id })
			.from(scheduledJobs)
			.where(and(
				eq(scheduledJobs.agent_id, args.id),
				eq(scheduledJobs.enabled, true),
			));
		for (const job of agentJobs) {
			invokeJobScheduleManager("DELETE", { triggerId: job.id });
		}
	}
	return !!row;
}
