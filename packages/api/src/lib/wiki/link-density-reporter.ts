/**
 * Link-density reporter — read-only snapshot of `wiki_page_links` coverage
 * per agent. Used by `scripts/wiki-link-density-baseline.ts` before and
 * after the densification push so R1-R3 / R5 are measurable.
 *
 * The shape here is deliberately small: a SQL query that returns one row
 * per agent plus a pure formatter that turns those rows into a fixed-
 * width table. Tests cover the formatter; the SQL is thin enough that an
 * integration smoke check catches regressions.
 */

import { and, eq, sql } from "drizzle-orm";
import {
	agents,
	wikiPageLinks,
	wikiPages,
} from "@thinkwork/database-pg/schema";
import type { DbClient } from "./repository.js";

export interface LinkDensityRow {
	agent_id: string;
	agent_name: string;
	pages: number;
	linked_pages: number;
	percent_linked: number; // 0..100
	reference_links: number;
	parent_of_links: number;
	child_of_links: number;
	duplicate_candidates: number;
}

interface QueryArgs {
	tenantId: string;
	/** If set, only this agent. Otherwise all agents in the tenant. */
	ownerId?: string;
}

/**
 * One query per metric keeps each aggregation legible — the alternative
 * (one mega-CTE) saves a few round-trips at the cost of readability and
 * isn't on any hot path (operator-facing script).
 */
export async function queryLinkDensity(
	db: DbClient,
	args: QueryArgs,
): Promise<LinkDensityRow[]> {
	const tenantWhere = eq(wikiPages.tenant_id, args.tenantId);
	const ownerWhere = args.ownerId
		? and(tenantWhere, eq(wikiPages.owner_id, args.ownerId))
		: tenantWhere;

	// Agents in scope — seed the result set so an agent with zero pages
	// still shows up.
	const agentRows = (await db
		.select({ id: agents.id, name: agents.name })
		.from(agents)
		.where(
			args.ownerId
				? and(
						eq(agents.tenant_id, args.tenantId),
						eq(agents.id, args.ownerId),
					)
				: eq(agents.tenant_id, args.tenantId),
		)) as Array<{ id: string; name: string }>;

	// Page counts per owner (`entity`/`topic`/`decision` all count — we care
	// about graph reachability, not taxonomy here).
	const pagesPerOwner = (await db
		.select({
			owner_id: wikiPages.owner_id,
			n: sql<number>`count(*)::int`,
		})
		.from(wikiPages)
		.where(ownerWhere)
		.groupBy(wikiPages.owner_id)) as Array<{ owner_id: string; n: number }>;

	// Pages with ≥1 outgoing or incoming `reference` link.
	const linkedPagesPerOwner = (await db.execute(sql`
			SELECT
				wp.owner_id AS owner_id,
				COUNT(DISTINCT wp.id)::int AS n
			FROM ${wikiPages} wp
			JOIN ${wikiPageLinks} wpl
				ON (wpl.from_page_id = wp.id OR wpl.to_page_id = wp.id)
				AND wpl.kind = 'reference'
			WHERE wp.tenant_id = ${args.tenantId}
				${args.ownerId ? sql`AND wp.owner_id = ${args.ownerId}` : sql``}
			GROUP BY wp.owner_id
		`)) as unknown as Array<{ owner_id: string; n: number }>;

	// Link counts per kind per owner — scope join via wp alias so we stay
	// inside (tenant, owner).
	const linksPerOwnerByKind = (await db.execute(sql`
			SELECT
				wp.owner_id AS owner_id,
				wpl.kind    AS kind,
				COUNT(*)::int AS n
			FROM ${wikiPageLinks} wpl
			JOIN ${wikiPages} wp ON wp.id = wpl.from_page_id
			WHERE wp.tenant_id = ${args.tenantId}
				${args.ownerId ? sql`AND wp.owner_id = ${args.ownerId}` : sql``}
			GROUP BY wp.owner_id, wpl.kind
		`)) as unknown as Array<{ owner_id: string; kind: string; n: number }>;

	// Duplicate title candidates: (title, owner_id) groups with >1 active row.
	// Tracks R5 precision canary from the plan.
	const duplicatesPerOwner = (await db.execute(sql`
			SELECT owner_id, COUNT(*)::int AS n
			FROM (
				SELECT owner_id, title
				FROM ${wikiPages}
				WHERE tenant_id = ${args.tenantId}
					${args.ownerId ? sql`AND owner_id = ${args.ownerId}` : sql``}
					AND status = 'active'
				GROUP BY owner_id, title
				HAVING COUNT(*) > 1
			) dup
			GROUP BY owner_id
		`)) as unknown as Array<{ owner_id: string; n: number }>;

	const pagesBy = indexBy(pagesPerOwner, (r) => r.owner_id);
	const linkedBy = indexBy(linkedPagesPerOwner, (r) => r.owner_id);
	const dupsBy = indexBy(duplicatesPerOwner, (r) => r.owner_id);

	const linksBy = new Map<string, { ref: number; parent: number; child: number }>();
	for (const row of linksPerOwnerByKind) {
		const bucket = linksBy.get(row.owner_id) ?? {
			ref: 0,
			parent: 0,
			child: 0,
		};
		if (row.kind === "reference") bucket.ref = row.n;
		else if (row.kind === "parent_of") bucket.parent = row.n;
		else if (row.kind === "child_of") bucket.child = row.n;
		linksBy.set(row.owner_id, bucket);
	}

	const out: LinkDensityRow[] = [];
	for (const a of agentRows) {
		const pages = pagesBy.get(a.id)?.n ?? 0;
		const linked = linkedBy.get(a.id)?.n ?? 0;
		const links = linksBy.get(a.id) ?? { ref: 0, parent: 0, child: 0 };
		out.push({
			agent_id: a.id,
			agent_name: a.name,
			pages,
			linked_pages: linked,
			percent_linked: computePercent(linked, pages),
			reference_links: links.ref,
			parent_of_links: links.parent,
			child_of_links: links.child,
			duplicate_candidates: dupsBy.get(a.id)?.n ?? 0,
		});
	}
	out.sort((x, y) => x.agent_name.localeCompare(y.agent_name));
	return out;
}

/**
 * Pure formatter. Exported so tests can pin the shape without touching
 * the database.
 */
export function formatDensityReport(rows: LinkDensityRow[]): string {
	if (rows.length === 0) {
		return "(no agents in scope)";
	}

	const header = [
		"agent".padEnd(24),
		"pages".padStart(8),
		"linked".padStart(8),
		"%".padStart(7),
		"refs".padStart(8),
		"parent".padStart(8),
		"child".padStart(8),
		"dup_titles".padStart(12),
	].join("  ");
	const divider = "-".repeat(header.length);

	const body = rows
		.map((r) =>
			[
				truncate(r.agent_name, 24).padEnd(24),
				String(r.pages).padStart(8),
				String(r.linked_pages).padStart(8),
				`${r.percent_linked.toFixed(1)}%`.padStart(7),
				String(r.reference_links).padStart(8),
				String(r.parent_of_links).padStart(8),
				String(r.child_of_links).padStart(8),
				String(r.duplicate_candidates).padStart(12),
			].join("  "),
		)
		.join("\n");

	return [header, divider, body].join("\n");
}

function computePercent(part: number, total: number): number {
	if (total <= 0) return 0;
	return Math.round((part / total) * 1000) / 10;
}

function indexBy<T, K>(rows: T[], keyFn: (r: T) => K): Map<K, T> {
	const m = new Map<K, T>();
	for (const r of rows) m.set(keyFn(r), r);
	return m;
}

function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return `${s.slice(0, n - 1)}…`;
}
