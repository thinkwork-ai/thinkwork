import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, asc, lt, sql, inArray,
	threads, messages, artifacts, costEvents, threadTurns, threadDependencies,
	messageToCamel, artifactToCamel, snakeToCamel, threadToCamel,
} from "../../utils.js";

export const threadTypeResolvers = {
	children: async (thread: any) => {
		if (Array.isArray(thread.children)) return thread.children;
		const rows = await db.select().from(threads).where(eq(threads.parent_id, thread.id));
		return rows.map(threadToCamel);
	},
	agent: (thread: any, _args: any, ctx: GraphQLContext) => {
		if (thread.agent && typeof thread.agent === "object") return thread.agent;
		const agentId = thread.agentId || thread.agent_id;
		return agentId ? ctx.loaders.agent.load(agentId) : null;
	},
	assignee: (thread: any, _args: any, ctx: GraphQLContext) => {
		if (thread.assignee && typeof thread.assignee === "object") return thread.assignee;
		const assigneeId = thread.assigneeId || thread.assignee_id;
		const assigneeType = thread.assigneeType || thread.assignee_type;
		if (assigneeType === "user" && assigneeId) return ctx.loaders.user.load(assigneeId);
		return null;
	},
	reporter: (thread: any, _args: any, ctx: GraphQLContext) => {
		if (thread.reporter && typeof thread.reporter === "object") return thread.reporter;
		const reporterId = thread.reporterId || thread.reporter_id;
		return reporterId ? ctx.loaders.user.load(reporterId) : null;
	},
	childCount: (thread: any, _args: any, ctx: GraphQLContext) => {
		if (typeof thread.childCount === "number") return thread.childCount;
		return ctx.loaders.threadChildCount.load(thread.id);
	},
	messages: async (thread: any, args: any, _ctx: GraphQLContext) => {
		const limit = Math.min(args.limit || 50, 200);
		const conditions = [eq(messages.thread_id, thread.id)];
		if (args.cursor) {
			conditions.push(lt(messages.created_at, new Date(args.cursor)));
		}
		const rows = await db
			.select()
			.from(messages)
			.where(and(...conditions))
			.orderBy(asc(messages.created_at))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = hasMore ? rows.slice(0, limit) : rows;
		const endCursor =
			hasMore && items.length > 0
				? items[items.length - 1].created_at.toISOString()
				: null;

		const messageIds = items.map((m) => m.id);
		let artifactsByMessageId: Record<string, Record<string, unknown>> = {};
		if (messageIds.length > 0) {
			const linkedArtifacts = await db
				.select()
				.from(artifacts)
				.where(inArray(artifacts.source_message_id, messageIds));
			for (const a of linkedArtifacts) {
				if (a.source_message_id) {
					artifactsByMessageId[a.source_message_id] = artifactToCamel(a);
				}
			}
		}

		return {
			edges: items.map((m) => ({
				node: {
					...messageToCamel(m),
					durableArtifact: artifactsByMessageId[m.id] ?? null,
				},
				cursor: m.created_at.toISOString(),
			})),
			pageInfo: { hasNextPage: hasMore, endCursor },
		};
	},
	lastActivityAt: async (thread: any, _args: any, ctx: GraphQLContext) => {
		if (thread.lastActivityAt) return thread.lastActivityAt;
		return ctx.loaders.threadLastActivityAt.load(thread.id);
	},
	costSummary: async (thread: any) => {
		const directCosts = await db
			.select({ total: sql<string>`COALESCE(SUM(amount_usd), 0)` })
			.from(costEvents)
			.where(eq(costEvents.thread_id, thread.id));

		const turnCosts = await db
			.select({ total: sql<string>`COALESCE(SUM(${costEvents.amount_usd}), 0)` })
			.from(costEvents)
			.innerJoin(
				threadTurns,
				sql`${threadTurns.wakeup_request_id}::text = ${costEvents.request_id}`,
			)
			.where(
				and(
					eq(threadTurns.thread_id, thread.id),
					sql`${costEvents.thread_id} IS NULL`,
				),
			);

		const total =
			Number(directCosts[0]?.total || 0) + Number(turnCosts[0]?.total || 0);
		return total > 0 ? total : null;
	},
	blockedBy: async (thread: any) => {
		const rows = await db
			.select()
			.from(threadDependencies)
			.where(eq(threadDependencies.thread_id, thread.id));
		return rows.map((r) => snakeToCamel(r));
	},
	blocks: async (thread: any) => {
		const rows = await db
			.select()
			.from(threadDependencies)
			.where(eq(threadDependencies.blocked_by_thread_id, thread.id));
		return rows.map((r) => snakeToCamel(r));
	},
	isBlocked: async (thread: any) => {
		const result = await db.execute(sql`
			SELECT EXISTS (
				SELECT 1 FROM thread_dependencies td
				JOIN threads t ON t.id = td.blocked_by_thread_id
				WHERE td.thread_id = ${thread.id}::uuid
				  AND t.status NOT IN ('done', 'cancelled')
			) AS blocked
		`);
		const row = (result.rows || [])[0] as { blocked: boolean } | undefined;
		return row?.blocked === true;
	},
};
