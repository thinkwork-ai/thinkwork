/**
 * compositionFeedbackSummary — rollup of positive/negative signals per skill.
 *
 * Powers R13 adoption metric rendering in the admin UI without pushing
 * raw SQL into the frontend. Tenant-scoped.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, sql, skillRuns } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export type CompositionFeedbackSummary = {
	skillId: string;
	positive: number;
	negative: number;
	total: number;
};

export async function compositionFeedbackSummary(
	_parent: unknown,
	args: { tenantId?: string | null; skillId?: string | null },
	ctx: GraphQLContext,
): Promise<CompositionFeedbackSummary[]> {
	const { tenantId: callerTenantId } = await resolveCaller(ctx);
	if (!callerTenantId) return [];

	const tenantId = args.tenantId ?? callerTenantId;
	if (tenantId !== callerTenantId) return [];

	const conditions = [eq(skillRuns.tenant_id, tenantId)];
	if (args.skillId) conditions.push(eq(skillRuns.skill_id, args.skillId));

	const rows = await db
		.select({
			skillId: skillRuns.skill_id,
			positive: sql<number>`count(*) filter (where feedback_signal = 'positive')`.as("positive"),
			negative: sql<number>`count(*) filter (where feedback_signal = 'negative')`.as("negative"),
			total: sql<number>`count(*) filter (where feedback_signal is not null)`.as("total"),
		})
		.from(skillRuns)
		.where(and(...conditions))
		.groupBy(skillRuns.skill_id);

	return rows.map((r) => ({
		skillId: r.skillId,
		positive: Number(r.positive),
		negative: Number(r.negative),
		total: Number(r.total),
	}));
}
