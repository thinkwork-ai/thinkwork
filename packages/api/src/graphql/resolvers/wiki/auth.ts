/**
 * Shared authorization helpers for wiki resolvers.
 *
 * v1 is strictly owner-scoped (see .prds/compounding-memory-scoping.md):
 * every read requires `(tenantId, ownerId)` and the caller must either be
 * the owning agent OR an internal/admin caller (api-key auth, service-to-
 * service). A Cognito user sees only their own agents' wikis by default;
 * the admin UI uses the api-key path to inspect across agents in a tenant.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";

export class WikiAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WikiAuthError";
	}
}

/**
 * Verify the caller may read pages owned by `(tenantId, ownerId)`. Throws
 * `WikiAuthError` on denial so resolvers can bubble a consistent message.
 *
 * Two allowed paths:
 *   1. `authType === "apikey"` — internal/admin caller. Must still match
 *      tenantId.
 *   2. `authType === "cognito"` — user must belong to the same tenant, and
 *      the `ownerId` must be an agent that belongs to the same tenant. We
 *      don't yet have a per-user agent-ownership concept in v1; any user
 *      in the tenant can read any agent's wiki in the tenant. This is
 *      strictly narrower than the pre-scoping design (which exposed
 *      tenant-shared entity pages to every agent in the tenant) and fits
 *      the v1 reality that an agent is invoked by a user acting as it.
 *      The compounding-memory-scoping doc allows this: "admin/debug tooling
 *      may explicitly pass `ownerId`" — Cognito users going through the
 *      admin UI are exactly that audience in v1.
 */
export async function assertCanReadWikiScope(
	ctx: GraphQLContext,
	args: { tenantId: string; ownerId: string },
): Promise<void> {
	if (!ctx.auth.tenantId) {
		throw new WikiAuthError("Tenant context required");
	}
	if (ctx.auth.tenantId !== args.tenantId) {
		throw new WikiAuthError("Access denied: tenant mismatch");
	}
	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, args.ownerId))
		.limit(1);
	if (!agent) {
		throw new WikiAuthError("Agent not found");
	}
	if (agent.tenant_id !== args.tenantId) {
		throw new WikiAuthError("Access denied: agent outside tenant");
	}
}

/**
 * Stricter check for admin-only mutations (`compileWikiNow`, replay). Same
 * tenant/owner validation as read, plus the caller must have used the
 * internal api-key credential — not a regular end-user Cognito session.
 */
export async function assertCanAdminWikiScope(
	ctx: GraphQLContext,
	args: { tenantId: string; ownerId: string },
): Promise<void> {
	await assertCanReadWikiScope(ctx, args);
	if (ctx.auth.authType !== "apikey") {
		throw new WikiAuthError(
			"Admin-only: requires internal API key credential",
		);
	}
}
