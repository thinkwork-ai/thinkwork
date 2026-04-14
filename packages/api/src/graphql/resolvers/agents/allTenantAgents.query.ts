import { isNull } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq, ne, and,
	agents as agentsTable,
	tenantMembers,
	agentToCamel,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

/**
 * Workspace-wide agent list for tenant owners/admins (used by the admin app).
 *
 * Distinct from `agents`, which is user-scoped: a tenant member only ever sees
 * agents paired to them. This resolver returns every non-archived agent in the
 * tenant, but only when the caller is a tenant `owner` or `admin`. Everyone
 * else gets an empty list (fail-closed).
 */
export async function allTenantAgents(
	_parent: any,
	args: { tenantId: string; includeSystem?: boolean; includeSubAgents?: boolean },
	ctx: GraphQLContext,
) {
	if (ctx.auth.authType !== "cognito") {
		return [];
	}
	const callerUserId = await resolveCallerUserId(ctx);
	if (!callerUserId) return [];

	const [member] = await db
		.select({ role: tenantMembers.role })
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, args.tenantId),
				eq(tenantMembers.principal_id, callerUserId),
			),
		);
	const role = member?.role;
	if (role !== "owner" && role !== "admin") return [];

	const conditions = [
		eq(agentsTable.tenant_id, args.tenantId),
		ne(agentsTable.status, "archived"),
	];
	if (!args.includeSystem) conditions.push(ne(agentsTable.source, "system"));
	if (!args.includeSubAgents) conditions.push(isNull(agentsTable.parent_agent_id));

	const rows = await db.select().from(agentsTable).where(and(...conditions));
	return rows.map((r) => agentToCamel(r));
}
