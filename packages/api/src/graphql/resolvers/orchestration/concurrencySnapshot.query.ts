import type { GraphQLContext } from "../../context.js";
import {
	db, sql,
} from "../../utils.js";

export const concurrencySnapshot = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const totalResult = await db.execute(sql`
		SELECT COUNT(*)::int AS count FROM threads
		WHERE tenant_id = ${args.tenantId}::uuid AND checkout_run_id IS NOT NULL
	`);
	const totalActive = ((totalResult.rows || [])[0] as { count: number } | undefined)?.count || 0;
	const byStatusResult = await db.execute(sql`
		SELECT status, COUNT(*)::int AS count FROM threads
		WHERE tenant_id = ${args.tenantId}::uuid AND checkout_run_id IS NOT NULL
		GROUP BY status
	`);
	const byAgentResult = await db.execute(sql`
		SELECT t.assignee_id AS agent_id, a.name AS agent_name, COUNT(*)::int AS count
		FROM threads t
		LEFT JOIN agents a ON a.id = t.assignee_id
		WHERE t.tenant_id = ${args.tenantId}::uuid AND t.checkout_run_id IS NOT NULL AND t.assignee_type = 'agent'
		GROUP BY t.assignee_id, a.name
	`);
	const byStatusRows = (byStatusResult.rows || []) as { status: string; count: number }[];
	const byAgentRows = (byAgentResult.rows || []) as { agent_id: string; agent_name: string; count: number }[];
	return {
		totalActive,
		byStatus: byStatusRows.map((r) => ({ status: r.status, count: r.count })),
		byAgent: byAgentRows.map((r) => ({ agentId: r.agent_id, agentName: r.agent_name, count: r.count })),
	};
};
