/**
 * Auth pre-check + tenant-scope resolution shared by the three U10
 * compliance resolvers (complianceEvents, complianceEvent,
 * complianceEventByHash).
 *
 * Two axes (per ce-doc-review safe_auto fix):
 *
 *   1. **Auth-type gate (apikey hard-block):** compliance reads are
 *      Cognito-only. The Strands runtime + any internal tool holding
 *      `API_AUTH_SECRET` is rejected at the resolver gate. Mirrors
 *      `requireNotFromAdminSkill` in
 *      `packages/api/src/graphql/resolvers/core/authz.ts` — same
 *      defense, narrower namespace.
 *
 *   2. **Operator-vs-tenant gate:** the existing
 *      `THINKWORK_PLATFORM_OPERATOR_EMAILS` allowlist (loaded into
 *      graphql-http via `terraform/modules/app/lambda-api/main.tf:44`)
 *      is the source of truth for "this user can browse all tenants."
 *      Operators may pass any `args.filter.tenantId`; non-operators
 *      have it server-side-overridden to `resolveCallerTenantId(ctx)`
 *      before SQL parameterization. Null-tenant non-operators throw
 *      `UNAUTHENTICATED` rather than fall through with a null filter.
 *
 * NO `ctx.auth.isAdmin` field exists in this codebase. The earlier
 * plan revision that referenced it was wrong — the operator-emails
 * allowlist is the actual mechanism.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../graphql/context.js";
import { resolveCallerTenantId } from "../../graphql/resolvers/core/resolve-auth-user.js";

export function isPlatformOperator(ctx: GraphQLContext): boolean {
	const allowlist = (process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (allowlist.length === 0) return false;
	const email =
		typeof ctx.auth.email === "string" ? ctx.auth.email.toLowerCase() : "";
	return email !== "" && allowlist.includes(email);
}

/**
 * Result of `requireComplianceReader`. `effectiveTenantId` is what the
 * resolver should pass to SQL — operators get whatever the caller
 * requested (or undefined for "all tenants"); non-operators get their
 * own tenant scope, with null fail-closed.
 */
export interface ResolverAuthScope {
	isOperator: boolean;
	effectiveTenantId: string | undefined;
}

/**
 * Run the apikey + operator + null-tenant pre-checks. Throws a
 * structured GraphQLError on any failure. On success, returns the
 * effective tenant scope the SQL should apply.
 *
 * `requestedTenantId` is the value the caller passed in
 * `args.filter.tenantId`. For operators, it's accepted as-is (or
 * undefined → all tenants). For non-operators, it's IGNORED and
 * replaced with their resolved tenant scope.
 */
export async function requireComplianceReader(
	ctx: GraphQLContext,
	requestedTenantId: string | undefined,
): Promise<ResolverAuthScope> {
	// 1. apikey hard-block. Compliance reads are Cognito-only.
	if (ctx.auth.authType !== "cognito") {
		throw new GraphQLError(
			"Compliance reads are restricted to Cognito-authenticated callers.",
			{ extensions: { code: "FORBIDDEN" } },
		);
	}

	// 2. Required env var.
	if (!process.env.COMPLIANCE_READER_SECRET_ARN) {
		throw new GraphQLError(
			"Compliance event browsing is not available in this environment — COMPLIANCE_READER_SECRET_ARN env var is unset on the graphql-http Lambda.",
			{ extensions: { code: "INTERNAL_SERVER_ERROR" } },
		);
	}

	// 3. Operator-vs-tenant gate.
	const isOperator = isPlatformOperator(ctx);
	if (isOperator) {
		return { isOperator: true, effectiveTenantId: requestedTenantId };
	}

	// Non-operator: forced to their own tenant. Resolve via the
	// Google-OAuth-friendly fallback per `feedback_oauth_tenant_resolver`.
	const resolved = await resolveCallerTenantId(ctx);
	if (!resolved) {
		throw new GraphQLError(
			"Compliance access requires either platform-operator email or a resolved tenant scope. Your session has neither — contact a Thinkwork administrator.",
			{ extensions: { code: "UNAUTHENTICATED" } },
		);
	}
	return { isOperator: false, effectiveTenantId: resolved };
}
