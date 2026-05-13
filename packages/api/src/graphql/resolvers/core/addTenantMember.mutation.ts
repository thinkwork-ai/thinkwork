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

	// Computer provisioning is opt-in per add-member call. Admins explicitly
	// pass `provisionComputer: true` when they want the helper to fire.
	// Members default to "mobile-only / no-Computer"; admins can provision
	// later via the Person-page CTA on /people/$humanId. Failure must NOT
	// block membership; the helper itself never throws.
	if (i.provisionComputer === true) {
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
	}

	return snakeToCamel(row);
};
