import type { GraphQLContext } from "../../context.js";
import {
	db, sql,
	workflowConfigToCamel,
} from "../../utils.js";

export const workflowConfig = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const result = await db.execute(sql`
		SELECT * FROM workflow_configs
		WHERE tenant_id = ${args.tenantId}::uuid
		  AND ${args.hiveId ? sql`hive_id = ${args.hiveId}::uuid` : sql`hive_id IS NULL`}
		LIMIT 1
	`);
	const row = (result.rows || [])[0] as Record<string, unknown> | undefined;
	if (!row) return null;
	return workflowConfigToCamel(row);
};
