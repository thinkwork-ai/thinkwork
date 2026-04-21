/**
 * Shared authorization helpers for tenant-scoped resolvers.
 *
 * `requireTenantAdmin` encapsulates the owner-or-admin check that was
 * duplicated inline across several resolvers (e.g. `allTenantAgents.query.ts`
 * lines 30-40). Callers that need atomicity between the role check and a
 * subsequent write (e.g. last-owner invariant in tenant member mutations)
 * can pass a transaction handle as `dbOrTx`.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb, eq, and, tenantMembers } from "../../utils.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";

export type TenantAdminRole = "owner" | "admin";

/**
 * Minimal duck-type that covers both the module-level `db` and a Drizzle
 * transaction handle (`tx`). Drizzle's `db` and `PgTransaction<...>` have
 * subtly different full types (e.g. only `db` has `$client`), but both
 * expose the `select` API we use for the role lookup.
 */
type DbOrTx = { select: typeof defaultDb.select };

function forbidden(message: string): GraphQLError {
	return new GraphQLError(message, {
		extensions: { code: "FORBIDDEN" },
	});
}

/**
 * Ensures the caller is an `owner` or `admin` of `tenantId`. Returns the
 * caller's role on success. Throws a `FORBIDDEN` GraphQLError otherwise.
 *
 * The optional `dbOrTx` handle routes the role lookup through a transaction
 * when one is provided — matching Drizzle's `db.transaction(async tx => ...)`
 * API. The caller-identity lookup (`resolveCallerUserId`) always runs on the
 * module-level `db`; that lookup is a prerequisite to the transactional
 * invariant, not part of it.
 */
export async function requireTenantAdmin(
	ctx: GraphQLContext,
	tenantId: string,
	dbOrTx: DbOrTx = defaultDb,
): Promise<TenantAdminRole> {
	if (ctx.auth.authType !== "cognito") {
		throw forbidden("Tenant admin role required");
	}
	const callerUserId = await resolveCallerUserId(ctx);
	if (!callerUserId) {
		throw forbidden("Tenant admin role required");
	}
	const [member] = await dbOrTx
		.select({ role: tenantMembers.role })
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_id, callerUserId),
			),
		);
	const role = member?.role;
	if (role === "owner" || role === "admin") {
		return role;
	}
	throw forbidden("Tenant admin role required");
}
