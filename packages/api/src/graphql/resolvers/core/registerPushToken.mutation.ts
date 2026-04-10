import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";

export const registerPushToken = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const email = ctx.auth.email;
	const cognitoSub = ctx.auth.principalId;
	if (!email && !cognitoSub) throw new Error("Unauthorized");

	const { token } = args.input;

	// Look up user by email (Cognito sub != users.id in this system)
	let userId: string | null = null;
	if (email) {
		const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
		userId = row?.id ?? null;
	}
	// Fallback: try Cognito sub directly
	if (!userId && cognitoSub) {
		const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, cognitoSub));
		userId = row?.id ?? null;
	}

	if (!userId) {
		console.error(`[registerPushToken] No user found for email=${email} cognitoSub=${cognitoSub}`);
		throw new Error("User not found");
	}

	await db
		.update(users)
		.set({ expo_push_token: token, updated_at: new Date() })
		.where(eq(users.id, userId));

	console.log(`[registerPushToken] Stored token for user ${userId} (${email}): ${token.slice(0, 30)}...`);
	return true;
};
