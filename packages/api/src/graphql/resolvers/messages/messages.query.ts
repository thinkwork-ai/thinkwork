import type { GraphQLContext } from "../../context.js";
import {
	db,
	eq,
	and,
	desc,
	lt,
	messages,
	threads,
	messageToCamel,
} from "../../utils.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

/**
 * Tenant-scoped messages query.
 *
 * Plan-012 U7 audit finding: prior to U7, this query selected by `threadId`
 * alone and did not enforce tenant scoping at the resolver level. Adding
 * `Message.parts` (which carries tool input/output and reasoning content,
 * categorically more sensitive than legacy `content`) made an explicit
 * tenant gate non-negotiable per
 * docs/specs/computer-ai-elements-contract-v1.md §Tenant scoping. This
 * resolver now refuses to return rows for a thread the caller's tenant
 * does not own.
 *
 * Implementation:
 *   1. Resolve the caller's tenant via `resolveCallerTenantId(ctx)` —
 *      `ctx.auth.tenantId` is null for Google-federated users until the
 *      Cognito pre-token trigger lands (per
 *      feedback_oauth_tenant_resolver), so the resolver helper is the
 *      safe path.
 *   2. Look up the thread by id AND `threads.tenant_id` matches the
 *      caller. Returning an empty page on mismatch (rather than throwing)
 *      mirrors how the rest of the GraphQL surface handles
 *      not-visible-to-caller rows and avoids leaking thread existence
 *      via error vs. empty.
 *   3. Only then read messages, scoped through the same tenant gate
 *      transitively.
 */
export const messages_ = async (
	_parent: unknown,
	args: { threadId: string; limit?: number; cursor?: string },
	ctx: GraphQLContext,
) => {
	const callerTenantId =
		ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
	if (!callerTenantId) {
		return {
			edges: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		};
	}

	const [thread] = await db
		.select({ id: threads.id, tenant_id: threads.tenant_id })
		.from(threads)
		.where(
			and(eq(threads.id, args.threadId), eq(threads.tenant_id, callerTenantId)),
		);
	if (!thread) {
		return {
			edges: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		};
	}

	const limit = Math.min(args.limit || 50, 200);
	const conditions = [
		eq(messages.thread_id, args.threadId),
		eq(messages.tenant_id, callerTenantId),
	];
	if (args.cursor) {
		conditions.push(lt(messages.created_at, new Date(args.cursor)));
	}
	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.created_at))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const endCursor =
		hasMore && items.length > 0
			? items[items.length - 1].created_at.toISOString()
			: null;

	return {
		edges: items.map((m) => ({
			node: messageToCamel(m),
			cursor: m.created_at.toISOString(),
		})),
		pageInfo: { hasNextPage: hasMore, endCursor },
	};
};
