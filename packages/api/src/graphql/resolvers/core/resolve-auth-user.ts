import type { GraphQLContext } from "../../context.js";
import { db, eq, users } from "../../utils.js";

/**
 * Resolve both the DB users.id AND tenant_id for the current Cognito caller.
 *
 * Google federated Cognito JWTs don't carry custom:tenant_id, so
 * `ctx.auth.tenantId` is null for OAuth users. Native Cognito users have
 * users.id == Cognito sub, but Google OAuth users get a fresh UUID and are
 * linked by email — so we fall back to an email lookup.
 *
 * Returns null fields for non-Cognito (API key) callers or when no matching
 * row is found. Resolvers that use this for access control should fail
 * closed on null.
 */
export async function resolveCaller(
	ctx: GraphQLContext,
): Promise<{ userId: string | null; tenantId: string | null }> {
	if (ctx.auth.authType !== "cognito") {
		return { userId: null, tenantId: null };
	}
	const principalId = ctx.auth.principalId;
	if (!principalId) return { userId: null, tenantId: null };

	const [byId] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.id, principalId));
	if (byId) return { userId: byId.id, tenantId: byId.tenant_id };

	const email = ctx.auth.email;
	if (!email) return { userId: null, tenantId: null };
	const [byEmail] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.email, email));
	return {
		userId: byEmail?.id ?? null,
		tenantId: byEmail?.tenant_id ?? null,
	};
}

/**
 * Back-compat: returns only the user id. Prefer `resolveCaller` when you
 * need the tenant id too — it's the same DB round-trip either way.
 */
export async function resolveCallerUserId(
	ctx: GraphQLContext,
): Promise<string | null> {
	const { userId } = await resolveCaller(ctx);
	return userId;
}

/**
 * Convenience: returns only the tenant id. Prefer `resolveCaller` when you
 * need both fields.
 */
export async function resolveCallerTenantId(
	ctx: GraphQLContext,
): Promise<string | null> {
	const { tenantId } = await resolveCaller(ctx);
	return tenantId;
}
