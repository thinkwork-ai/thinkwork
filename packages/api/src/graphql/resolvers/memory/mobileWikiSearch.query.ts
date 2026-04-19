/**
 * mobileWikiSearch — Postgres FTS over compiled wiki pages in one
 * (tenant, agent) scope.
 *
 * Ranks compiled pages by `ts_rank(search_tsv, plainto_tsquery('english',
 * query))` against the GIN-indexed `search_tsv` generated column on
 * `wiki_pages` (title || summary || body_md). On the target corpus
 * (~hundreds of pages per agent) this returns in <50ms end-to-end.
 *
 * History: this resolver previously routed through Hindsight semantic
 * recall + a `wiki_section_sources` reverse-join. That path dominated
 * mobile latency at ~10 seconds per query for what users actually typed
 * (page titles like "Austin", "Dake's Shoppe"). FTS over the compiled
 * corpus is the right tool for that query shape; conceptual recall is
 * deferred until we see a real need for it on this surface.
 *
 * Response shape is preserved for GraphQL wire compatibility with live
 * mobile clients: `{ page, score, matchingMemoryIds }`. The memory-ids
 * field is always [] on this path — pages are matched against their own
 * compiled text, not against source memory units.
 *
 * v1 scope rule: every wiki page is agent-scoped. The WHERE clause pins
 * `tenant_id` and `owner_id` so cross-agent visibility is impossible.
 */

import { eq, sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db, agents } from "../../utils.js";
import { toGraphQLPage } from "../wiki/mappers.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface MobileWikiSearchRow {
	id: string;
	tenant_id: string;
	owner_id: string;
	type: string;
	slug: string;
	title: string;
	summary: string | null;
	body_md: string | null;
	status: string;
	last_compiled_at: Date | null;
	created_at: Date;
	updated_at: Date;
	score: number;
}

export const mobileWikiSearch = async (
	_parent: unknown,
	args: { agentId: string; query: string; limit?: number },
	ctx: GraphQLContext,
) => {
	const { agentId, query, limit = DEFAULT_LIMIT } = args;
	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
	if (!tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const ownerId = agent.id as string;
	const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

	const result = await db.execute(sql`
		SELECT
			p.id, p.tenant_id, p.owner_id, p.type, p.slug,
			p.title, p.summary, p.body_md, p.status,
			p.last_compiled_at, p.created_at, p.updated_at,
			COALESCE(ts_rank(p.search_tsv, plainto_tsquery('english', ${trimmed})), 0)::float AS score
		FROM wiki_pages p
		WHERE p.tenant_id = ${tenantId}
		  AND p.owner_id = ${ownerId}
		  AND p.status = 'active'
		  AND p.search_tsv @@ plainto_tsquery('english', ${trimmed})
		ORDER BY score DESC, p.last_compiled_at DESC NULLS LAST
		LIMIT ${cappedLimit}
	`);

	const rows = ((result as unknown as { rows?: MobileWikiSearchRow[] }).rows ??
		[]) as MobileWikiSearchRow[];

	console.log(
		`[mobileWikiSearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} pages=${rows.length}`,
	);

	// Diagnostic: mobile clients report receiving 0 results even when the
	// Lambda logs pages>0. Dump the raw first row and the shape of the
	// first mapped result so we can see whether a field type mismatch is
	// causing GraphQL to null out the response. Remove once the root
	// cause is identified.
	if (rows.length > 0) {
		const sample = rows[0];
		console.log(
			`[mobileWikiSearch][diag] rawFirstRow keys=${Object.keys(sample).join(",")} types=${Object.entries(
				sample,
			)
				.map(
					([k, v]) =>
						`${k}:${v === null ? "null" : v instanceof Date ? "Date" : typeof v}`,
				)
				.join("|")}`,
		);
	}

	const mapped = rows.map((r) => ({
		page: toGraphQLPage(
			{
				id: r.id,
				tenant_id: r.tenant_id,
				owner_id: r.owner_id,
				type: r.type,
				slug: r.slug,
				title: r.title,
				summary: r.summary,
				body_md: r.body_md,
				status: r.status,
				last_compiled_at: r.last_compiled_at,
				created_at: r.created_at,
				updated_at: r.updated_at,
			},
			{ sections: [], aliases: [] },
		),
		score: r.score,
		matchingMemoryIds: [] as string[],
	}));

	if (mapped.length > 0) {
		const first = mapped[0];
		console.log(
			`[mobileWikiSearch][diag] mappedFirst score=${first.score}(${typeof first.score}) matchingMemoryIds=${JSON.stringify(first.matchingMemoryIds)} page.id=${first.page.id} page.type=${first.page.type} page.createdAt=${first.page.createdAt} page.updatedAt=${first.page.updatedAt}`,
		);
	}

	return mapped;
};
