import type { GraphQLContext } from "../../context.js";
import {
	db, eq, and, desc, asc, sql,
	threads, threadToCamel,
} from "../../utils.js";

export const threadsPaged_query = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const conditions: any[] = [eq(threads.tenant_id, args.tenantId)];

	// Filter: scope to a single Computer when the caller passes one. Plan
	// 2026-05-13-005 U1 — admin Computer Detail Dashboard renders the same
	// shared ThreadsTable as /threads, filtered to a specific Computer.
	// Tenant scoping above still applies; the computerId predicate is layered
	// on top so a cross-tenant computerId returns empty rather than leaking.
	if (args.computerId) {
		conditions.push(eq(threads.computer_id, args.computerId));
	}

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
