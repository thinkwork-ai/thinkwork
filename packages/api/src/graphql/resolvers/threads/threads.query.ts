import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, sql,
	threads, computers, threadToCamel,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { requireComputerReadAccess } from "../computers/shared.js";

export const threads_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	// When the caller scopes to a specific Computer, enforce per-user ownership
	// of that Computer in the same tenant. Without this gate, a user with a
	// valid Cognito JWT for tenant T can pass any Computer's id and read its
	// threads — even if they don't own that Computer. The tenant gate alone
	// is not sufficient at multi-user-per-tenant scale (which the v1 plan
	// explicitly targets: 4 enterprises × 100+ agents per tenant). See
	// docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md
	// and the F1/F5 P0 findings on PR #959.
	//
	// Bypasses (preserving prior behavior so admin operator workflows and
	// service-to-service callers don't regress):
	//   - apikey callers: skip the per-user gate entirely. They're trusted
	//     infrastructure pre-authorized by the shared API secret; the
	//     tenant_id filter further down still isolates by tenant.
	//   - tenant admins: allowed via the existing `requireComputerReadAccess`
	//     helper, which permits owner OR tenant-admin on the row's tenant.
	//     This matches admin's Computer detail surfaces (apps/admin's
	//     /computers/$id route) where operators read threads on Computers
	//     they don't personally own.
	if (args.computerId && ctx.auth.authType !== "apikey") {
		const [computerRow] = await db
			.select()
			.from(computers)
			.where(
				and(
					eq(computers.id, args.computerId),
					eq(computers.tenant_id, args.tenantId),
				),
			);
		if (!computerRow) return [];
		try {
			await requireComputerReadAccess(ctx, computerRow);
		} catch (err) {
			// Caller is neither the Computer owner nor a tenant admin.
			// Return [] rather than re-throwing so existing GraphQL clients
			// see "no threads" instead of an authz error — matches the
			// previous (silent) behavior on no-access reads.
			if (err instanceof GraphQLError) return [];
			throw err;
		}
	}

	const conditions = [eq(threads.tenant_id, args.tenantId)];
	if (args.status) conditions.push(eq(threads.status, args.status.toLowerCase()));
	if (args.channel) {
		conditions.push(eq(threads.channel, args.channel.toLowerCase()));
	} else {
		// When no channel specified (Inbox), exclude task-channel threads
		conditions.push(sql`${threads.channel} != 'task'`);
	}
	if (args.agentId) conditions.push(eq(threads.agent_id, args.agentId));
	if (args.computerId) conditions.push(eq(threads.computer_id, args.computerId));
	if (args.assigneeId) {
		// Mobile passes user.sub (Cognito) as assigneeId. For Google-OAuth
		// users the DB users.id is a fresh UUID linked by email, so sub !=
		// users.id. When the caller is asking for "threads assigned to me"
		// (passing their own Cognito principalId), rewrite to the caller's
		// DB users.id so threads.assignee_id (which is a users.id FK)
		// actually matches. Non-self filters pass through unchanged.
		let effectiveAssigneeId = args.assigneeId;
		if (
			ctx.auth.authType === "cognito" &&
			args.assigneeId === ctx.auth.principalId
		) {
			const dbId = await resolveCallerUserId(ctx);
			if (dbId) effectiveAssigneeId = dbId;
		}
		conditions.push(eq(threads.assignee_id, effectiveAssigneeId));
	}
	if (args.search) {
		conditions.push(
			sql`search_vector @@ plainto_tsquery('english', ${args.search})`,
		);
	}
	const limit = Math.min(args.limit || 200, 500);
	const rows = await db
		.select()
		.from(threads)
		.where(and(...conditions))
		.orderBy(desc(threads.created_at))
		.limit(limit);

	return rows.map((r) => threadToCamel(r));
};
