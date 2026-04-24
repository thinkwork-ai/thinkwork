import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, asc, sql,
	threads, threadToCamel,
} from "../../utils.js";

export const threadsPaged_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions: any[] = [eq(threads.tenant_id, args.tenantId)];

	// Filter: archived vs non-archived
	if (args.showArchived) {
		conditions.push(sql`${threads.archived_at} IS NOT NULL`);
	} else {
		conditions.push(sql`${threads.archived_at} IS NULL`);
	}

	// Filter: statuses (array)
	if (args.statuses?.length) {
		const lower = args.statuses.map((s: string) => s.toLowerCase());
		conditions.push(sql`${threads.status} = ANY(${lower})`);
	}

	// Filter: priorities (array)
	if (args.priorities?.length) {
		const lower = args.priorities.map((p: string) => p.toLowerCase());
		conditions.push(sql`${threads.priority} = ANY(${lower})`);
	}

	// Filter: search
	if (args.search) {
		conditions.push(
			sql`search_vector @@ plainto_tsquery('english', ${args.search})`,
		);
	}

	const whereClause = and(...conditions);

	// Sort
	const sortField = args.sortField || "updated";
	const sortDir = args.sortDir || "desc";
	const dirFn = sortDir === "asc" ? asc : desc;

	let orderClause;
	switch (sortField) {
		case "status":
			orderClause = dirFn(threads.status);
			break;
		case "priority":
			orderClause = dirFn(threads.priority);
			break;
		case "title":
			orderClause = dirFn(threads.title);
			break;
		case "created":
			orderClause = dirFn(threads.created_at);
			break;
		case "updated":
		default:
			orderClause = dirFn(threads.updated_at);
			break;
	}

	const limit = args.limit || 50;
	const offset = args.offset || 0;

	const [countResult, rows] = await Promise.all([
		db.select({ count: sql<number>`COUNT(*)::int` })
			.from(threads)
			.where(whereClause),
		db.select().from(threads)
			.where(whereClause)
			.orderBy(orderClause)
			.limit(limit)
			.offset(offset),
	]);

	return {
		items: rows.map((r) => threadToCamel(r)),
		totalCount: countResult[0]?.count ?? 0,
	};
};
