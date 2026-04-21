/**
 * skillRun — fetch one run for drill-in UI.
 *
 * Tenant-scoped + invoker-scoped: non-invokers see 404. The admin-wide
 * "see all tenant runs" view arrives in Unit 7 when the admin group claim
 * lands.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and,
	skillRuns,
	snakeToCamel,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export async function skillRun(
	_parent: unknown,
	args: { id: string },
	ctx: GraphQLContext,
): Promise<Record<string, unknown> | null> {
	const { userId, tenantId } = await resolveCaller(ctx);
	if (!userId || !tenantId) return null;

	const [row] = await db
		.select()
		.from(skillRuns)
		.where(and(eq(skillRuns.id, args.id), eq(skillRuns.tenant_id, tenantId)));
	if (!row) return null;
	if (row.invoker_user_id !== userId) return null;

	return snakeToCamel(row as Record<string, unknown>);
}
