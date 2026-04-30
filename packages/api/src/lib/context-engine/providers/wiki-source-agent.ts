import {
	normalizeWikiSearchTerms,
	searchWikiForUser,
	type UserWikiSearchResult,
} from "../../wiki/search.js";
import type { ContextHit } from "../types.js";
import { createSubAgentContextProvider } from "./sub-agent-base.js";

const WIKI_SOURCE_AGENT_LIMIT = 10;
const WIKI_SOURCE_AGENT_MAX_SEARCH_PATHS = 3;
const QUERY_REPAIRS = new Map([
	["restarant", "restaurant"],
	["resturant", "restaurant"],
	["restraunt", "restaurant"],
	["restaraunt", "restaurant"],
	["restraurant", "restaurant"],
	["fav", "favorite"],
	["favourite", "favorite"],
]);

export type WikiSourceAgentSearch = (args: {
	tenantId: string;
	userId: string;
	query: string;
	limit: number;
}) => Promise<UserWikiSearchResult[]>;

export interface WikiSourceAgentPlanStep {
	query: string;
	purpose: "original" | "repaired" | "focused";
	repairs?: Array<{ from: string; to: string }>;
}

export function createWikiSourceAgentContextProvider(options: {
	search?: WikiSourceAgentSearch;
	defaultEnabled?: boolean;
} = {}) {
	const search = options.search ?? searchWikiForUser;
	return createSubAgentContextProvider({
		id: "wiki-source-agent",
		displayName: "Company Brain Page Agent",
		promptRef: "brain/provider/wiki-source-agent",
		prompt: {
			title: "Company Brain wiki navigator",
			summary:
				"Plan search paths, repair query language, inspect compiled pages, and return cited wiki evidence.",
			instructions: [
				"Start with the user's original query so exact wording still has a chance to win.",
				"Repair obvious misspellings or vocabulary drift before widening the search.",
				"Use focused page terms for a final pass, then dedupe and rank pages by evidence.",
			],
		},
		resources: [
			{
				id: "wiki-pages",
				label: "Compiled Company Brain pages",
				type: "Postgres wiki_pages",
				description:
					"Active entity, topic, and decision pages compiled from user memory and sources.",
				access: "read",
			},
			{
				id: "wiki-aliases-search",
				label: "Aliases and lexical index",
				type: "Postgres wiki_page_aliases + search_tsv",
				description:
					"Alias matching, prefix tsquery, and trigram fallback for typo-tolerant retrieval.",
				access: "read",
			},
			{
				id: "wiki-section-sources",
				label: "Section source citations",
				type: "Postgres wiki_section_sources",
				description:
					"Memory and source references used to explain why a compiled page belongs in context.",
				access: "read",
			},
		],
		skills: [
			{
				id: "query-repair",
				label: "Query repair",
				description:
					"Corrects common misspellings and vocabulary variants before searching again.",
			},
			{
				id: "multi-pass-navigation",
				label: "Multi-pass navigation",
				description:
					"Runs original, repaired, and focused search paths in parallel like source-local tool calls.",
			},
			{
				id: "evidence-rerank",
				label: "Evidence reranking",
				description:
					"Dedupe pages and boost results whose title, aliases, summary, or body support the query.",
			},
		],
		toolAllowlist: ["company-brain.pages.search", "company-brain.pages.read"],
		depthCap: 2,
		processModel: "deterministic-retrieval",
		defaultEnabled: options.defaultEnabled ?? false,
		timeoutMs: 2_500,
		seamState: "live",
		supportedScopes: ["personal", "auto"],
		seam: async (request, config) => {
			if (!request.caller.userId) {
				return {
					hits: [],
					state: "skipped",
					reason: "user scope is required for Company Brain page agent",
				};
			}

			const userId = request.caller.userId;
			const plan = planWikiSourceAgentQueries(request.query);
			const searches = await Promise.all(
				plan.map(async (step) => ({
					step,
					rows: await search({
						tenantId: request.caller.tenantId,
						userId,
						query: step.query,
						limit: Math.min(request.limit, WIKI_SOURCE_AGENT_LIMIT),
					}),
				})),
			);
			const rows = rankWikiSourceAgentResults({
				searches,
				originalQuery: request.query,
				limit: Math.min(request.limit, WIKI_SOURCE_AGENT_LIMIT),
			});
			const inspectedPageCount = countUniquePages(searches);

			return {
				state: "ok",
				reason: `searched ${plan.length} query path${
					plan.length === 1 ? "" : "s"
				}; inspected ${inspectedPageCount} compiled page${
					inspectedPageCount === 1 ? "" : "s"
				}`,
				hits: rows.map(({ row, score, sourceStep }): ContextHit => ({
					id: `wiki-agent:${row.page.id}`,
					providerId: config.id,
					family: "wiki",
					title: row.page.title,
					snippet: row.page.summary || row.page.title,
					score,
					scope: request.scope,
					provenance: {
						label: "Company Brain page agent",
						sourceId: row.page.id,
						uri: `thinkwork://wiki/${row.page.type.toLowerCase()}/${row.page.slug}`,
						metadata: {
							promptRef: config.promptRef,
							toolAllowlist: config.toolAllowlist,
							depthCap: config.depthCap,
							retrievalStrategy: "agentic-hybrid-wiki-navigation",
							matchedAlias: row.matchedAlias,
							sourceQuery: sourceStep.query,
							sourceQueryPurpose: sourceStep.purpose,
						},
					},
					metadata: {
						page: row.page,
						sourceAgent: {
							id: config.id,
							processModel: "deterministic-retrieval",
							toolAllowlist: config.toolAllowlist,
							retrievalStrategy: "agentic-hybrid-wiki-navigation",
							plan,
							inspectedPageCount,
						},
					},
				})),
			};
		},
	});
}

export function planWikiSourceAgentQueries(query: string): WikiSourceAgentPlanStep[] {
	const original = query.trim();
	if (!original) return [];

	const steps: WikiSourceAgentPlanStep[] = [
		{ query: original, purpose: "original" },
	];

	const repaired = repairQueryTerms(original);
	if (repaired.query && repaired.query.toLowerCase() !== original.toLowerCase()) {
		steps.push({
			query: repaired.query,
			purpose: "repaired",
			repairs: repaired.repairs,
		});
	}

	const focusedTerms = normalizeWikiSearchTerms(repaired.query || original).filter(
		(term) => !["tell", "show", "find", "about"].includes(term),
	);
	const focused = reorderPageAgentTerms(focusedTerms).join(" ");
	if (
		focused.length > 0 &&
		!steps.some((step) => step.query.toLowerCase() === focused.toLowerCase())
	) {
		steps.push({ query: focused, purpose: "focused" });
	}

	return steps.slice(0, WIKI_SOURCE_AGENT_MAX_SEARCH_PATHS);
}

function repairQueryTerms(query: string): {
	query: string;
	repairs: Array<{ from: string; to: string }>;
} {
	const repairs: Array<{ from: string; to: string }> = [];
	const next = query.replace(/\b[a-z0-9]+\b/gi, (raw) => {
		const replacement = QUERY_REPAIRS.get(raw.toLowerCase());
		if (!replacement) return raw;
		repairs.push({ from: raw, to: replacement });
		return replacement;
	});
	return { query: next, repairs };
}

function reorderPageAgentTerms(terms: string[]): string[] {
	const priority = new Map([
		["favorite", 100],
		["restaurant", 90],
		["customer", 80],
		["project", 80],
		["decision", 80],
		["runbook", 80],
		["paris", 70],
	]);
	return [...terms].sort((a, b) => {
		const priorityDelta = (priority.get(b) ?? 0) - (priority.get(a) ?? 0);
		return priorityDelta || a.localeCompare(b);
	});
}

function rankWikiSourceAgentResults(args: {
	searches: Array<{ step: WikiSourceAgentPlanStep; rows: UserWikiSearchResult[] }>;
	originalQuery: string;
	limit: number;
}): Array<{
	row: UserWikiSearchResult;
	score: number;
	sourceStep: WikiSourceAgentPlanStep;
}> {
	const queryTerms = normalizeWikiSearchTerms(args.originalQuery).map(
		(term) => QUERY_REPAIRS.get(term) ?? term,
	);
	const byPageId = new Map<
		string,
		{ row: UserWikiSearchResult; score: number; sourceStep: WikiSourceAgentPlanStep }
	>();

	for (const search of args.searches) {
		for (const row of search.rows) {
			const score =
				row.score +
				(search.step.purpose === "original" ? 0 : 0.08) +
				evidenceScore(row, queryTerms);
			const existing = byPageId.get(row.page.id);
			if (!existing || score > existing.score) {
				byPageId.set(row.page.id, {
					row,
					score,
					sourceStep: search.step,
				});
			}
		}
	}

	return [...byPageId.values()]
		.sort((a, b) => b.score - a.score || a.row.page.title.localeCompare(b.row.page.title))
		.slice(0, args.limit);
}

function evidenceScore(row: UserWikiSearchResult, queryTerms: string[]): number {
	if (queryTerms.length === 0) return 0;
	const haystack = [
		row.page.title,
		row.page.summary,
		row.page.bodyMd,
		row.page.aliases?.join(" "),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
	return Math.min(0.2, (matchedTerms.length / queryTerms.length) * 0.2);
}

function countUniquePages(
	searches: Array<{ rows: UserWikiSearchResult[] }>,
): number {
	return new Set(searches.flatMap((search) => search.rows.map((row) => row.page.id)))
		.size;
}
