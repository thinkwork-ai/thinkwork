import type { GraphQLContext } from "../../context.js";
import {
	agentTemplates,
	and,
	db,
	eq,
	isNull,
	or,
	templateToCamel,
} from "../../utils.js";
import { withGraphqlAgentRuntime } from "../agents/runtime.js";

/**
 * Returns the union of tenant-scoped + platform-shipped Computer templates
 * for the given tenant. Unlike `agentTemplates(tenantId)` which filters
 * strictly by `tenant_id = $tenantId`, this query also includes
 * `tenant_id IS NULL` rows (platform defaults) so the admin Computer
 * create-dialog can surface the platform-default template alongside any
 * tenant-authored Computer templates.
 *
 * Authz matches the existing `agentTemplates` query — open to any caller
 * with a valid GraphQL context; tenancy is the only filter. The downstream
 * picker UX assumes the caller is at least a tenant member; the gate that
 * actually creates a Computer (`createComputer` / the auto-provision helper)
 * enforces tenant-admin separately.
 */
export async function computerTemplates_query(
	_parent: unknown,
	args: { tenantId: string },
	_ctx: GraphQLContext,
) {
	const rows = await db
		.select()
		.from(agentTemplates)
		.where(
			and(
				eq(agentTemplates.template_kind, "computer"),
				or(
					eq(agentTemplates.tenant_id, args.tenantId),
					isNull(agentTemplates.tenant_id),
				),
			),
		);
	return rows.map((row) => withGraphqlAgentRuntime(templateToCamel(row)));
}
