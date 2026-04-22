import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	agents, scheduledJobs,
	agentToCamel,
	invokeJobScheduleManager,
} from "../../utils.js";
import { writeUserMdForAssignment } from "../../../lib/user-md-writer.js";
import { writeIdentityMdForAgent } from "../../../lib/identity-md-writer.js";
import { invalidateComposerCache } from "../../../lib/workspace-overlay.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function updateAgent(_parent: any, args: any, ctx: GraphQLContext) {
	// Authz:
	//
	//   - Cognito JWT callers: resolve the caller's tenant_id, then scope
	//     the update so only agents in that tenant can be targeted. This
	//     closes the pre-existing cross-tenant rename gap (PR #386 review
	//     finding ADV-005) — guessing another tenant's agent UUID used to
	//     work; now the WHERE clause rejects it as "not found".
	//
	//   - Service-auth (apikey) callers: MUST present `x-agent-id` whose
	//     value equals `args.id`. This lets agent self-serve tools call
	//     the mutation (e.g., `update_agent_name`) while rejecting any
	//     broader apikey-holder from renaming arbitrary agents. Missing
	//     or mismatched header → FORBIDDEN.
	const { tenantId: callerTenantId } = await resolveCaller(ctx);
	if (ctx.auth.authType === "apikey") {
		if (!ctx.auth.agentId || ctx.auth.agentId !== args.id) {
			throw new Error(
				"FORBIDDEN: service-auth callers must present x-agent-id matching the target agent id",
			);
		}
		// Service caller must also have provided x-tenant-id (the apikey
		// handler populates callerTenantId from that header).
		if (!callerTenantId) {
			throw new Error(
				"FORBIDDEN: service-auth callers must present x-tenant-id",
			);
		}
	} else {
		// JWT callers: tenant is required for the scoped WHERE below.
		if (!callerTenantId) {
			throw new Error("UNAUTHORIZED: caller tenant could not be resolved");
		}
	}

	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) {
		// Reject `null` and empty-string names loudly. Without this guard,
		// `nameProvided` would be true while `nameActuallyChanged` (string
		// typeof check) would be false — the DB would accept `null` but the
		// IDENTITY.md writer would skip, silently drifting S3 from the DB.
		if (typeof i.name !== "string" || i.name.trim() === "") {
			throw new Error("Agent name must be a non-empty string");
		}
		updates.name = i.name;
	}
	if (i.role !== undefined) updates.role = i.role;
	if (i.type !== undefined) updates.type = i.type.toLowerCase();
	if (i.templateId !== undefined) updates.template_id = i.templateId;
	if (i.systemPrompt !== undefined) updates.system_prompt = i.systemPrompt;
	if (i.adapterType !== undefined) updates.adapter_type = i.adapterType;
	if (i.adapterConfig !== undefined) updates.adapter_config = JSON.parse(i.adapterConfig);
	if (i.runtimeConfig !== undefined) updates.runtime_config = JSON.parse(i.runtimeConfig);
	if (i.budgetMonthlyCents !== undefined) updates.budget_monthly_cents = i.budgetMonthlyCents;
	if (i.avatarUrl !== undefined) updates.avatar_url = i.avatarUrl;
	if (i.reportsTo !== undefined) updates.reports_to = i.reportsTo;
	if (i.humanPairId !== undefined) updates.human_pair_id = i.humanPairId;
	if (i.parentAgentId !== undefined) updates.parent_agent_id = i.parentAgentId;

	const humanPairIdChanging = i.humanPairId !== undefined;
	const nameProvided = i.name !== undefined;

	// Side-effect writes wrap in a transaction so DB + S3 stay atomic.
	//
	// - humanPairId change → writeUserMdForAssignment rewrites USER.md
	//   (Unit 6). A failure rolls back the pair change so DB never points
	//   at human B while USER.md still renders human A.
	//
	// - name change → writeIdentityMdForAgent does name-line surgery on
	//   IDENTITY.md (personality-templates plan). A failure rolls back
	//   the rename so the agent's DB name and IDENTITY.md never drift.
	//
	// Other update paths (runtime_config scheduled-job sync, etc.) stay
	// out of the transaction — their side effects are recoverable via
	// retry and shouldn't block a routine update from committing.
	let row: typeof agents.$inferSelect | null = null;
	// Cache invalidations to fire AFTER the txn commits. Firing inside the
	// txn would clear the composer cache before the DB settles — if a later
	// step rolls back, the composer would then read fresh S3 state that no
	// longer matches the rolled-back DB row.
	const cacheInvalidations: Array<{ tenantId: string; agentId: string }> = [];
	if (humanPairIdChanging || nameProvided) {
		row = await db.transaction(async (tx) => {
			const [pre] = await tx
				.select({
					human_pair_id: agents.human_pair_id,
					name: agents.name,
					tenant_id: agents.tenant_id,
				})
				.from(agents)
				.where(
					and(
						eq(agents.id, args.id),
						eq(agents.tenant_id, callerTenantId),
					),
				);
			if (!pre) throw new Error("Agent not found");
			const oldPairId = pre.human_pair_id ?? null;
			const newPairId = (i.humanPairId as string | null) ?? null;
			const oldName = pre.name;
			const nameActuallyChanged =
				nameProvided && typeof i.name === "string" && i.name !== oldName;

			const [updated] = await tx
				.update(agents)
				.set(updates)
				.where(
					and(
						eq(agents.id, args.id),
						eq(agents.tenant_id, callerTenantId),
					),
				)
				.returning();
			if (!updated) throw new Error("Agent not found");

			// Only rewrite USER.md when the pair actually changed. Stable
			// no-op reassignments (setting the same id) shouldn't burn an
			// S3 PUT or invalidate cache.
			if (humanPairIdChanging && oldPairId !== newPairId) {
				try {
					await writeUserMdForAssignment(tx, args.id, newPairId);
					console.log(
						`[updateAgent] user_md_write agentId=${args.id} success=true`,
					);
					cacheInvalidations.push({
						tenantId: pre.tenant_id,
						agentId: args.id,
					});
				} catch (err) {
					const errorCategory =
						(err as { code?: string } | null)?.code ||
						(err as { name?: string } | null)?.name ||
						"unknown";
					console.warn(
						`[updateAgent] user_md_write agentId=${args.id} success=false errorCategory=${errorCategory}`,
					);
					throw err; // roll back the transaction
				}
			}

			// Only rewrite IDENTITY.md when the name actually changed —
			// burning a PUT + cache invalidation on every updateAgent that
			// merely touches runtime_config would be wasteful.
			if (nameActuallyChanged) {
				try {
					await writeIdentityMdForAgent(tx, args.id);
					console.log(
						`[updateAgent] identity_md_write agentId=${args.id} oldName=${oldName} newName=${i.name} success=true`,
					);
					cacheInvalidations.push({
						tenantId: pre.tenant_id,
						agentId: args.id,
					});
				} catch (err) {
					const errorCategory =
						(err as { code?: string } | null)?.code ||
						(err as { name?: string } | null)?.name ||
						"unknown";
					console.warn(
						`[updateAgent] identity_md_write agentId=${args.id} success=false errorCategory=${errorCategory}`,
					);
					throw err; // roll back the transaction
				}
			}

			return updated;
		});

		// Txn committed successfully — now safe to invalidate the composer
		// cache so the next read reflects the new S3 state.
		for (const entry of cacheInvalidations) {
			invalidateComposerCache(entry);
		}
	} else {
		const [updated] = await db
			.update(agents)
			.set(updates)
			.where(
				and(eq(agents.id, args.id), eq(agents.tenant_id, callerTenantId)),
			)
			.returning();
		if (!updated) throw new Error("Agent not found");
		row = updated;
	}
	if (!row) throw new Error("Agent not found");

	// Sync scheduled job if runtime_config changed
	if (i.runtimeConfig !== undefined) {
		const newConfig = JSON.parse(i.runtimeConfig);
		const heartbeat = newConfig?.heartbeat;
		if (heartbeat?.enabled) {
			// Find existing heartbeat job for this agent, or create new
			const [existingJob] = await db
				.select({ id: scheduledJobs.id })
				.from(scheduledJobs)
				.where(and(
					eq(scheduledJobs.agent_id, args.id),
					eq(scheduledJobs.trigger_type, "agent_heartbeat"),
				))
				.limit(1);

			if (existingJob) {
				invokeJobScheduleManager("PUT", {
					jobId: existingJob.id,
					scheduleExpression: String(heartbeat.intervalSec || 300),
					scheduleType: "rate",
					prompt: heartbeat.prompt || undefined,
					config: heartbeat,
					enabled: true,
				});
			} else {
				invokeJobScheduleManager("POST", {
					tenantId: row.tenant_id,
					jobType: "agent_heartbeat",
					agentId: args.id,
					name: `Heartbeat: ${row.name}`,
					scheduleType: "rate",
					scheduleExpression: String(heartbeat.intervalSec || 300),
					config: heartbeat,
					createdByType: "system",
				});
			}
		} else if (heartbeat && heartbeat.enabled === false) {
			// Disable existing heartbeat job
			const [existingJob] = await db
				.select({ id: scheduledJobs.id })
				.from(scheduledJobs)
				.where(and(
					eq(scheduledJobs.agent_id, args.id),
					eq(scheduledJobs.trigger_type, "agent_heartbeat"),
				))
				.limit(1);
			if (existingJob) {
				invokeJobScheduleManager("DELETE", { triggerId: existingJob.id });
			}
		}
	}

	return agentToCamel(row);
}
