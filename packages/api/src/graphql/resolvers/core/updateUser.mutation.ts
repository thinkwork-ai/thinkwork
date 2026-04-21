import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	users,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "./resolve-auth-user.js";
import { requireTenantAdmin } from "./authz.js";

/**
 * Update a user's editable profile fields.
 *
 * Authz: self-or-admin. The caller may always edit their own user row. To
 * edit another user, the caller must be `owner` or `admin` in that user's
 * home tenant (`users.tenant_id`). Users with a null home tenant can only
 * be self-edited.
 */
export const updateUser = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [target] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.id, args.id));
	if (!target) {
		throw new GraphQLError("User not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}

	const { userId: callerUserId } = await resolveCaller(ctx);
	const isSelf = !!callerUserId && callerUserId === target.id;

	if (!isSelf) {
		if (!target.tenant_id) {
			throw new GraphQLError("Not permitted to edit this user", {
				extensions: { code: "FORBIDDEN" },
			});
		}
		await requireTenantAdmin(ctx, target.tenant_id);
	}

	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.image !== undefined) updates.image = i.image;
	if (i.phone !== undefined) updates.phone = i.phone;
	const [row] = await db.update(users).set(updates).where(eq(users.id, args.id)).returning();
	if (!row) {
		throw new GraphQLError("User not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}
	return snakeToCamel(row);
};
