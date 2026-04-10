import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	userProfiles,
	snakeToCamel,
} from "../../utils.js";

export const updateUserProfile = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (i.displayName !== undefined) updates.display_name = i.displayName;
	if (i.theme !== undefined) updates.theme = i.theme;
	if (i.notificationPreferences !== undefined)
		updates.notification_preferences = JSON.parse(i.notificationPreferences);
	const [row] = await db
		.update(userProfiles)
		.set(updates)
		.where(eq(userProfiles.user_id, args.userId))
		.returning();
	if (!row) throw new Error("User profile not found");
	return snakeToCamel(row);
};
