import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	tenantMembers,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "./resolve-auth-user.js";
import { requireTenantAdmin } from "./authz.js";

/**
 * Update a tenant member's role and/or status.
 *
 * Authz: admin-only (owner or admin) in the target's tenant. Callers cannot
 * change their own membership through this path. Only existing owners may
 * grant the `owner` role. The last owner of a tenant cannot be demoted.
 *
 * The target row and (when demoting an owner) all sibling owner rows are
 * locked with `SELECT ... FOR UPDATE` inside a transaction to serialize
 * concurrent mutations that would otherwise race the tenant to zero owners.
 */
export const updateTenantMember = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { userId: callerUserId } = await resolveCaller(ctx);

	return db.transaction(async (tx) => {
		const [target] = await tx
			.select()
			.from(tenantMembers)
			.where(eq(tenantMembers.id, args.id))
			.for("update");
		if (!target) {
			throw new GraphQLError("Member not found", {
				extensions: { code: "NOT_FOUND" },
			});
		}

		const callerRole = await requireTenantAdmin(ctx, target.tenant_id, tx);

		if (callerUserId && callerUserId === target.principal_id) {
			throw new GraphQLError("Cannot change your own membership", {
				extensions: { code: "FORBIDDEN" },
			});
		}

		const newRole = args.input.role;
		const roleChanging = newRole !== undefined && newRole !== target.role;

		if (roleChanging && newRole === "owner" && callerRole !== "owner") {
			throw new GraphQLError("Only owners can grant the owner role", {
				extensions: { code: "FORBIDDEN" },
			});
		}

		if (roleChanging && target.role === "owner" && newRole !== "owner") {
			const owners = await tx
				.select({ id: tenantMembers.id })
				.from(tenantMembers)
				.where(
					and(
						eq(tenantMembers.tenant_id, target.tenant_id),
						eq(tenantMembers.role, "owner"),
					),
				)
				.for("update");
			if (owners.length <= 1) {
				throw new GraphQLError("Cannot demote the last owner of a tenant", {
					extensions: { code: "LAST_OWNER" },
				});
			}
		}

		const updates: Record<string, unknown> = { updated_at: new Date() };
		if (args.input.role !== undefined) updates.role = args.input.role;
		if (args.input.status !== undefined) updates.status = args.input.status;
		const [row] = await tx
			.update(tenantMembers)
			.set(updates)
			.where(eq(tenantMembers.id, args.id))
			.returning();
		if (!row) {
			throw new GraphQLError("Member not found", {
				extensions: { code: "NOT_FOUND" },
			});
		}
		return snakeToCamel(row);
	});
};
