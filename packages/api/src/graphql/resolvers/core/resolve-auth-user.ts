import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";

/**
 * Resolve the DB users.id for the current Cognito caller.
 *
 * For native Cognito users, users.id historically matched the Cognito sub. For
 * Google OAuth users the DB row is created with a fresh UUID and linked by
 * email, so we have to fall back to an email lookup — mirroring the pattern in
 * `me.query.ts`.
 *
 * Returns null for non-Cognito (API key) callers or when no matching row is
 * found. Resolvers that use this for access control should fail closed on null.
 */
export async function resolveCallerUserId(
	ctx: GraphQLContext,
): Promise<string | null> {
	if (ctx.auth.authType !== "cognito") return null;
	const principalId = ctx.auth.principalId;
	if (!principalId) return null;

	const [byId] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.id, principalId));
	if (byId) return byId.id;

	const email = ctx.auth.email;
	if (!email) return null;
	const [byEmail] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email));
	return byEmail?.id ?? null;
}
