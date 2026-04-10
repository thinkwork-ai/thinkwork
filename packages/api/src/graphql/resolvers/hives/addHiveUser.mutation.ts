import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	hives, hiveUsers,
	snakeToCamel,
} from "../../utils.js";

export const addHiveUser = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const [hive] = await db.select({ tenant_id: hives.tenant_id }).from(hives).where(eq(hives.id, args.hiveId));
	if (!hive) throw new Error("Hive not found");
	const [row] = await db
		.insert(hiveUsers)
		.values({
			hive_id: args.hiveId,
			user_id: i.userId,
			tenant_id: hive.tenant_id,
			role: i.role ?? "member",
			joined_at: new Date(),
		})
		.returning();
	return snakeToCamel(row);
};
