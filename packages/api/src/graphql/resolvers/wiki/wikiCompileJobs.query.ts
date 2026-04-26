/**
 * wikiCompileJobs — admin-only: list the most recent compile jobs for a
 * (tenant, owner?) scope.
 *
 * Supplies the `thinkwork wiki status` CLI command with just enough signal
 * (status, trigger, timestamps, metrics, error) to render a job-history
 * table without polling `wiki_compile_jobs` directly.
 *
 * When `userId` is supplied the response is scoped to that user; when
 * null/absent the response spans the whole tenant and is intended for
 * operator use.
 */

import type { GraphQLContext } from "../../context.js";
import { listCompileJobsForScope } from "../../../lib/wiki/repository.js";
import { assertCanAdminWikiScope, WikiAuthError } from "./auth.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

interface WikiCompileJobsArgs {
	tenantId: string;
	userId?: string | null;
	ownerId?: string | null;
	limit?: number | null;
}

export const wikiCompileJobs = async (
	_parent: unknown,
	args: WikiCompileJobsArgs,
	ctx: GraphQLContext,
) => {
	const requestedUserId = args.userId ?? args.ownerId ?? null;
	let scopedUserId: string | null = null;
	if (requestedUserId) {
		const scope = await assertCanAdminWikiScope(ctx, {
			tenantId: args.tenantId,
			userId: args.userId,
			ownerId: args.ownerId,
		});
		scopedUserId = scope.userId;
	} else {
		// Tenant-wide variant: require api-key credential + matching tenant,
		// but skip the per-agent existence check since there's no owner to
		// validate.
		const callerTenantId =
			ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
		if (!callerTenantId) {
			throw new WikiAuthError("Tenant context required");
		}
		if (callerTenantId !== args.tenantId) {
			throw new WikiAuthError("Access denied: tenant mismatch");
		}
		if (ctx.auth.authType !== "apikey") {
			throw new WikiAuthError(
				"Admin-only: requires internal API key credential",
			);
		}
	}

	const jobs = await listCompileJobsForScope({
		tenantId: args.tenantId,
		ownerId: scopedUserId,
		limit: args.limit ?? 10,
	});

	return jobs.map((job) => ({
		id: job.id,
		tenantId: job.tenant_id,
		userId: job.owner_id,
		ownerId: job.owner_id,
		status: job.status,
		trigger: job.trigger,
		dedupeKey: job.dedupe_key,
		attempt: job.attempt,
		claimedAt: job.claimed_at?.toISOString() ?? null,
		startedAt: job.started_at?.toISOString() ?? null,
		finishedAt: job.finished_at?.toISOString() ?? null,
		error: job.error,
		metrics: job.metrics,
		createdAt: job.created_at.toISOString(),
	}));
};
