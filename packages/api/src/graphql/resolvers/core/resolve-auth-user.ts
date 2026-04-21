import type { GraphQLContext } from "../../context.js";
import type { AuthResult } from "../../../lib/cognito-auth.js";
import { db, eq, users } from "../../utils.js";

/**
 * Resolve both the DB users.id AND tenant_id for a Cognito caller from a
 * bare AuthResult. Used by non-GraphQL Lambda handlers (like
 * /api/workspaces/files, Unit 5) that don't have a GraphQLContext but need
 * the same tenant-resolution semantics as `resolveCaller`.
 *
 * Google federated Cognito JWTs don't carry custom:tenant_id, so
 * `auth.tenantId` is null for OAuth users. Native Cognito users have
 * users.id == Cognito sub, but Google OAuth users get a fresh UUID and are
 * linked by email — so we fall back to an email lookup.
 */
export async function resolveCallerFromAuth(
	auth: AuthResult,
): Promise<{ userId: string | null; tenantId: string | null }> {
	if (auth.authType !== "cognito") {
		return { userId: null, tenantId: null };
	}
	const principalId = auth.principalId;
	if (!principalId) return { userId: null, tenantId: null };

	const [byId] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.id, principalId));
	if (byId) return { userId: byId.id, tenantId: byId.tenant_id };

	const email = auth.email;
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
 * Resolve both the DB users.id AND tenant_id for the current Cognito caller.
 *
 * Returns null fields for non-Cognito (API key) callers or when no matching
 * row is found. Resolvers that use this for access control should fail
 * closed on null.
 */
export async function resolveCaller(
	ctx: GraphQLContext,
): Promise<{ userId: string | null; tenantId: string | null }> {
	return resolveCallerFromAuth(ctx.auth);
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
