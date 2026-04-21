import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	tenantMembers,
} from "../../utils.js";
import { resolveCaller } from "./resolve-auth-user.js";
import { requireTenantAdmin } from "./authz.js";

/**
 * Hard-delete a tenant member.
 *
 * Authz: admin-only (owner or admin) in the target's tenant. Callers cannot
 * remove themselves through this path (a dedicated "leave tenant" flow can
 * exist separately). The last owner of a tenant cannot be removed — see
 * `updateTenantMember` for the matching demote guard.
 *
 * The target row and (when removing an owner) all sibling owner rows are
 * locked with `SELECT ... FOR UPDATE` inside a transaction so two concurrent
 * admin actions cannot both observe owner_count > 1 and each delete their
 * target, leaving the tenant with zero owners.
 */
export const removeTenantMember = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { userId: callerUserId } = await resolveCaller(ctx);

	return db.transaction(async (tx) => {
		const [target] = await tx
			.select()
			.from(tenantMembers)
			.where(eq(tenantMembers.id, args.id))
			.for("update");
		if (!target) return false;

		await requireTenantAdmin(ctx, target.tenant_id, tx);

		if (callerUserId && callerUserId === target.principal_id) {
			throw new GraphQLError("Cannot remove yourself", {
				extensions: { code: "FORBIDDEN" },
			});
		}

		if (target.role === "owner") {
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
				throw new GraphQLError("Cannot remove the last owner of a tenant", {
					extensions: { code: "LAST_OWNER" },
				});
			}
		}

		const [row] = await tx.delete(tenantMembers).where(eq(tenantMembers.id, args.id)).returning();
		return !!row;
	});
};
