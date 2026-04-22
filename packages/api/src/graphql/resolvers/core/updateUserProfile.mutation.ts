import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	agents,
	and,
	db,
	eq,
	snakeToCamel,
	userProfiles,
	users,
} from "../../utils.js";
import { invalidateComposerCache } from "../../../lib/workspace-overlay.js";
import { writeUserMdForAssignment } from "../../../lib/user-md-writer.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCaller } from "./resolve-auth-user.js";

/**
 * Update a user's profile row.
 *
 * Side effect: every agent paired to this user gets its USER.md
 * re-rendered inside the same DB transaction (same pattern as
 * `updateAgent` with a human_pair_id change). An S3 failure rolls the
 * profile update back so DB + composed USER.md never drift.
 *
 * Authz:
 *
 *   - **Cognito JWT, self:** caller may always edit their own profile.
 *   - **Cognito JWT, admin:** must be `owner`/`admin` in the target
 *     user's home tenant.
 *   - **Service (apikey):** the caller MUST present `x-agent-id`, and
 *     that agent MUST be currently paired (`human_pair_id = args.userId`).
 *     Prevents an apikey-holder from editing profiles of arbitrary users
 *     across the tenant; scopes self-serve tool writes to the agent's
 *     own paired human only.
 */
export const updateUserProfile = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const [target] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.id, args.userId));
	if (!target) {
		throw new GraphQLError("User not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}

	if (ctx.auth.authType === "apikey") {
		// Service caller: must present x-agent-id AND that agent must be
		// paired with the target user.
		if (!ctx.auth.agentId) {
			throw new GraphQLError(
				"Service-auth callers must present x-agent-id",
				{ extensions: { code: "FORBIDDEN" } },
			);
		}
		if (!target.tenant_id) {
			throw new GraphQLError(
				"Target user has no tenant; service-auth cannot edit",
				{ extensions: { code: "FORBIDDEN" } },
			);
		}
		const [agent] = await db
			.select({ human_pair_id: agents.human_pair_id, tenant_id: agents.tenant_id })
			.from(agents)
			.where(
				and(
					eq(agents.id, ctx.auth.agentId),
					eq(agents.tenant_id, target.tenant_id),
				),
			);
		if (!agent || agent.human_pair_id !== args.userId) {
			throw new GraphQLError(
				"Agent is not paired with the target user",
				{ extensions: { code: "FORBIDDEN" } },
			);
		}
	} else {
		const { userId: callerUserId } = await resolveCaller(ctx);
		const isSelf = !!callerUserId && callerUserId === target.id;
		if (!isSelf) {
			if (!target.tenant_id) {
				throw new GraphQLError("Not permitted to edit this profile", {
					extensions: { code: "FORBIDDEN" },
				});
			}
			await requireTenantAdmin(ctx, target.tenant_id);
		}
	}

	const i = args.input;

	// Server-side mirror of the tool-level 10KB cap. Prevents an apikey
	// holder calling GraphQL directly from writing unbounded content and
	// bloating every USER.md re-render in the fan-out.
	const MAX_FIELD_LENGTH = 10_000;
	for (const field of [
		"callBy",
		"notes",
		"family",
		"context",
		"title",
		"timezone",
		"pronouns",
	] as const) {
		const value = i[field];
		if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
			throw new GraphQLError(
				`${field} exceeds ${MAX_FIELD_LENGTH} characters`,
				{ extensions: { code: "BAD_INPUT" } },
			);
		}
	}

	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.displayName !== undefined) updates.display_name = i.displayName;
	if (i.theme !== undefined) updates.theme = i.theme;
	if (i.notificationPreferences !== undefined)
		updates.notification_preferences = JSON.parse(i.notificationPreferences);
	if (i.title !== undefined) updates.title = i.title;
	if (i.timezone !== undefined) updates.timezone = i.timezone;
	if (i.pronouns !== undefined) updates.pronouns = i.pronouns;
	if (i.callBy !== undefined) updates.call_by = i.callBy;
	if (i.notes !== undefined) updates.notes = i.notes;
	if (i.family !== undefined) updates.family = i.family;
	if (i.context !== undefined) updates.context = i.context;

	// Decide whether the update affects any {{HUMAN_*}} placeholder that
	// flows into USER.md. If yes, fan out to every paired agent so
	// USER.md re-renders. Display-only fields (displayName / theme /
	// notificationPreferences) don't touch USER.md — skip the fan-out
	// for those.
	const affectsUserMd =
		i.title !== undefined ||
		i.timezone !== undefined ||
		i.pronouns !== undefined ||
		i.callBy !== undefined ||
		i.notes !== undefined ||
		i.family !== undefined ||
		i.context !== undefined;

	// Cache invalidations to fire AFTER the txn commits (same pattern as
	// updateAgent).
	const cacheInvalidations: Array<{ tenantId: string; agentId: string }> = [];

	const row = await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(userProfiles)
			.set(updates)
			.where(eq(userProfiles.user_id, args.userId))
			.returning();
		if (!updated) {
			throw new GraphQLError("User profile not found", {
				extensions: { code: "NOT_FOUND" },
			});
		}

		if (affectsUserMd) {
			const pairedAgents = await tx
				.select({ id: agents.id, tenant_id: agents.tenant_id })
				.from(agents)
				.where(eq(agents.human_pair_id, args.userId));
			for (const a of pairedAgents) {
				try {
					await writeUserMdForAssignment(tx, a.id, args.userId);
					cacheInvalidations.push({
						tenantId: a.tenant_id,
						agentId: a.id,
					});
					console.log(
						`[updateUserProfile] user_md_write agentId=${a.id} userId=${args.userId} success=true`,
					);
				} catch (err) {
					const errorCategory =
						(err as { code?: string } | null)?.code ||
						(err as { name?: string } | null)?.name ||
						"unknown";
					console.warn(
						`[updateUserProfile] user_md_write agentId=${a.id} userId=${args.userId} success=false errorCategory=${errorCategory}`,
					);
					throw err; // roll back the whole transaction
				}
			}
		}

		return updated;
	});

	// Wrap each invalidation independently — if one throws, the remaining
	// agents still get invalidated. A stale composer cache is recoverable
	// (30s TTL) but silently skipping entries is not.
	for (const entry of cacheInvalidations) {
		try {
			invalidateComposerCache(entry);
		} catch (err) {
			console.warn(
				`[updateUserProfile] cache_invalidation agentId=${entry.agentId} failed:`,
				err,
			);
		}
	}

	return snakeToCamel(row);
};
