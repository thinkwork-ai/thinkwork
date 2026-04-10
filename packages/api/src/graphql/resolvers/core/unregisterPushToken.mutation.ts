import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";

export const unregisterPushToken = async (_parent: any, _args: any, ctx: GraphQLContext) => {
	const email = ctx.auth.email;
	const cognitoSub = ctx.auth.principalId;
	if (!email && !cognitoSub) throw new Error("Unauthorized");

	// Look up user by email (Cognito sub != users.id in this system)
	let userId: string | null = null;
	if (email) {
		const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
		userId = row?.id ?? null;
	}
	if (!userId && cognitoSub) {
		const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, cognitoSub));
		userId = row?.id ?? null;
	}

	if (!userId) return true;

	await db
		.update(users)
		.set({ expo_push_token: null, updated_at: new Date() })
		.where(eq(users.id, userId));

	console.log(`[unregisterPushToken] Cleared token for user ${userId}`);
	return true;
};
