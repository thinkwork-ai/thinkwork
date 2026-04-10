import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	users,
	snakeToCamel,
} from "../../utils.js";

export const me = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const principalId = ctx.headers["x-principal-id"] || ctx.auth.principalId || "";
	if (!principalId) return null;

	// Look up by ID first (Cognito sub), then fall back to email
	const [row] = await db.select().from(users).where(eq(users.id, principalId));
	if (row) return snakeToCamel(row);

	// Fallback: Cognito sub may differ from DB user ID (e.g. Google OAuth users).
	// Use email from the auth token to find the user.
	const email = ctx.auth.email;
	if (!email) return null;
	const [byEmail] = await db.select().from(users).where(eq(users.email, email));
	return byEmail ? snakeToCamel(byEmail) : null;
};
