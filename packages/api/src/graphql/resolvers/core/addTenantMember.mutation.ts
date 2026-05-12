import type { GraphQLContext } from "../../context.js";
import { db, tenantMembers, snakeToCamel } from "../../utils.js";
import { provisionComputerForMember } from "../../../lib/computers/provision.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";

export const addTenantMember = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	await requireTenantAdmin(ctx, args.tenantId);
	const i = args.input;
	const [row] = await db
		.insert(tenantMembers)
		.values({
			tenant_id: args.tenantId,
			principal_type: i.principalType,
			principal_id: i.principalId,
			role: i.role ?? "member",
			status: "active",
		})
		.returning();

	// Best-effort Computer auto-provision. Failure must NOT block membership;
	// the createTenant sandbox-provision precedent is the in-repo pattern.
	// The helper itself never throws — this catch is defense-in-depth for an
	// unexpected programming error.
	try {
		const adminUserId = await resolveCallerUserId(ctx);
		await provisionComputerForMember({
			tenantId: args.tenantId,
			userId: i.principalId,
			principalType: i.principalType,
			callSite: "addTenantMember",
			adminUserId,
		});
	} catch (err) {
		console.error(
			"[addTenantMember] unexpected provisioning throw (suppressed):",
			err,
		);
	}

	return snakeToCamel(row);
};
