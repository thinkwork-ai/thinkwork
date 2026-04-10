import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hives, hivePolicies,
	snakeToCamel,
} from "../../utils.js";

export const setHivePolicy = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [hive] = await db.select({ tenant_id: hives.tenant_id }).from(hives).where(eq(hives.id, args.hiveId));
	if (!hive) throw new Error("Hive not found");
	const [row] = await db
		.insert(hivePolicies)
		.values({
			hive_id: args.hiveId,
			tenant_id: hive.tenant_id,
			policy_type: i.policyType,
			config: i.config ? JSON.parse(i.config) : undefined,
			enabled: i.enabled ?? true,
		})
		.returning();
	return snakeToCamel(row);
};
