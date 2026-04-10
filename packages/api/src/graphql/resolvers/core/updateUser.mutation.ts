import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	users,
	snakeToCamel,
} from "../../utils.js";

export const updateUser = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.name !== undefined) updates.name = i.name;
	if (i.image !== undefined) updates.image = i.image;
	if (i.phone !== undefined) updates.phone = i.phone;
	const [row] = await db.update(users).set(updates).where(eq(users.id, args.id)).returning();
	if (!row) throw new Error("User not found");
	return snakeToCamel(row);
};
