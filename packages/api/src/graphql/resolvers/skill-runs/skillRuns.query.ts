/**
 * skillRuns — paginated list for observability + history UIs.
 *
 * Tenant-scoped + invoker-scoped by default. Filter args let callers
 * narrow by agent, skill, status, or source. Default sort is started_at
 * desc so the most recent run lands first in the UI.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc,
	skillRuns as skillRunsTable,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function skillRuns(
	_parent: unknown,
	args: {
		tenantId?: string | null;
		agentId?: string | null;
		invokerUserId?: string | null;
		skillId?: string | null;
		status?: string | null;
		invocationSource?: string | null;
		limit?: number | null;
	},
	ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
	const { userId, tenantId: callerTenantId } = await resolveCaller(ctx);
	if (!userId || !callerTenantId) return [];

	const tenantId = args.tenantId ?? callerTenantId;
	if (tenantId !== callerTenantId) return []; // cross-tenant → empty, not 403

	// Scope to the invoker unless they explicitly asked for their own id
	// — admin-wide list waits for Unit 7's role check. Passing
	// invokerUserId=<self> is allowed; passing someone else's id is treated
	// as "no results" rather than leaking existence.
	const targetInvokerId = args.invokerUserId ?? userId;
	if (targetInvokerId !== userId) return [];

	const conditions = [
		eq(skillRunsTable.tenant_id, tenantId),
		eq(skillRunsTable.invoker_user_id, targetInvokerId),
	];
	if (args.agentId) conditions.push(eq(skillRunsTable.agent_id, args.agentId));
	if (args.skillId) conditions.push(eq(skillRunsTable.skill_id, args.skillId));
	if (args.status) conditions.push(eq(skillRunsTable.status, args.status));
	if (args.invocationSource) {
		conditions.push(eq(skillRunsTable.invocation_source, args.invocationSource));
	}

	const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

	const rows = await db
		.select()
		.from(skillRunsTable)
		.where(and(...conditions))
		.orderBy(desc(skillRunsTable.started_at))
		.limit(limit);

	return rows.map((r) => snakeToCamel(r as Record<string, unknown>));
}
