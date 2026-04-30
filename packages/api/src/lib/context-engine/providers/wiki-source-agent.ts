import {
	normalizeWikiSearchTerms,
	searchWikiForUser,
	type UserWikiSearchResult,
} from "../../wiki/search.js";
import type { ContextEngineProviderRequest, ContextHit } from "../types.js";
import {
	createSubAgentContextProvider,
	type SubAgentContextProviderConfig,
	type SubAgentSeamResult,
} from "./sub-agent-base.js";
import {
	runSourceAgent,
	type SourceAgentFinalResult,
	type SourceAgentModel,
	type SourceAgentRunResult,
} from "./source-agent-runtime.js";
import { createWikiSourceAgentTools } from "./wiki-source-agent-tools.js";

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

export type WikiSourceAgentRuntimeMode = "model" | "deterministic";

export interface WikiSourceAgentPlanStep {
	query: string;
	purpose: "original" | "repaired" | "focused";
	repairs?: Array<{ from: string; to: string }>;
}

export function createWikiSourceAgentContextProvider(options: {
	search?: WikiSourceAgentSearch;
	defaultEnabled?: boolean;
	runtimeMode?: WikiSourceAgentRuntimeMode;
	model?: SourceAgentModel;
} = {}) {
	const search = options.search ?? searchWikiForUser;
	const runtimeMode = options.runtimeMode ?? "model";
	return createSubAgentContextProvider({
		id: "wiki-source-agent",
		displayName: "Company Brain Page Agent",
		sourceFamily: "pages",
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
		depthCap: 3,
		processModel:
			runtimeMode === "model"
				? "lambda-bedrock-converse"
				: "deterministic-retrieval",
		defaultEnabled: options.defaultEnabled ?? false,
		timeoutMs: runtimeMode === "model" ? 15_000 : 2_500,
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
			const limit = Math.min(request.limit, WIKI_SOURCE_AGENT_LIMIT);
			if (runtimeMode === "deterministic") {
				return runDeterministicWikiSourceAgent({
					search,
					request,
					config,
					userId,
					limit,
					fallbackFrom: null,
				});
			}

			const toolSet = createWikiSourceAgentTools({
				tenantId: request.caller.tenantId,
				userId,
				defaultLimit: limit,
				search,
			});
			const agentRun = await runSourceAgent({
				name: config.displayName,
				system: buildWikiSourceAgentSystemPrompt(config),
				query: request.query,
				tools: toolSet.tools,
				allowedTools: config.toolAllowlist,
				depthCap: config.depthCap,
				model: options.model,
			});

			if (agentRun.state !== "ok") {
				return runDeterministicWikiSourceAgent({
					search,
					request,
					config,
					userId,
					limit,
					fallbackFrom: agentRun,
				});
			}

			const hits = agentRun.finalResults
				.map((result, index): ContextHit | null => {
					const row = toolSet.getPage(result.sourceId);
					if (!row) return null;
					return modelResultToHit({
						row,
						result,
						index,
						request,
						providerId: config.id,
						promptRef: config.promptRef,
						toolAllowlist: config.toolAllowlist,
						depthCap: config.depthCap,
						agentRun,
					});
				})
				.filter((hit): hit is ContextHit => hit !== null)
				.slice(0, limit);

			if (hits.length === 0) {
				return runDeterministicWikiSourceAgent({
					search,
					request,
					config,
					userId,
					limit,
					fallbackFrom: {
						...agentRun,
						state: "error",
						reason: "source agent final answer produced no resolvable pages",
					},
				});
			}

			return {
				state: "ok",
				reason: `source agent ran ${agentRun.model.turns} model turn${
					agentRun.model.turns === 1 ? "" : "s"
				}, ${agentRun.toolCallCount} tool call${
					agentRun.toolCallCount === 1 ? "" : "s"
				}; cited ${hits.length} compiled page${hits.length === 1 ? "" : "s"}`,
				metadata: {
					sourceAgent: {
						id: config.id,
						processModel: "lambda-bedrock-converse",
						model: agentRun.model,
						toolCallCount: agentRun.toolCallCount,
						trace: agentRun.trace,
						observedSourceIds: agentRun.observedSourceIds,
					},
				},
				hits,
			};
		},
	});
}

async function runDeterministicWikiSourceAgent(args: {
	search: WikiSourceAgentSearch;
	request: ContextEngineProviderRequest;
	config: SubAgentContextProviderConfig;
	userId: string;
	limit: number;
	fallbackFrom: SourceAgentRunResult | null;
}): Promise<SubAgentSeamResult> {
	const plan = planWikiSourceAgentQueries(args.request.query);
	const searches = await Promise.all(
		plan.map(async (step) => ({
			step,
			rows: await args.search({
				tenantId: args.request.caller.tenantId,
				userId: args.userId,
				query: step.query,
				limit: args.limit,
			}),
		})),
	);
	const rows = rankWikiSourceAgentResults({
		searches,
		originalQuery: args.request.query,
		limit: args.limit,
	});
	const inspectedPageCount = countUniquePages(searches);
	const fallbackReason = args.fallbackFrom?.reason;

	return {
		state: "ok",
		reason: `${
			fallbackReason ? `model fallback: ${fallbackReason}; ` : ""
		}searched ${plan.length} query path${plan.length === 1 ? "" : "s"}; inspected ${
			inspectedPageCount
		} compiled page${inspectedPageCount === 1 ? "" : "s"}`,
		metadata: {
			sourceAgent: {
				id: args.config.id,
				processModel: args.fallbackFrom
					? "lambda-bedrock-converse-with-deterministic-fallback"
					: "deterministic-retrieval",
				fallback: !!args.fallbackFrom,
				fallbackReason,
				trace: args.fallbackFrom?.trace,
			},
		},
		hits: rows.map(({ row, score, sourceStep }): ContextHit => ({
			id: `wiki-agent:${row.page.id}`,
			providerId: args.config.id,
			family: "wiki",
			title: row.page.title,
			snippet: row.page.summary || row.page.title,
			score,
			scope: args.request.scope,
			provenance: {
				label: "Company Brain page agent",
				sourceId: row.page.id,
				uri: `thinkwork://wiki/${row.page.type.toLowerCase()}/${row.page.slug}`,
				metadata: {
					promptRef: args.config.promptRef,
					toolAllowlist: args.config.toolAllowlist,
					depthCap: args.config.depthCap,
					retrievalStrategy: "agentic-hybrid-wiki-navigation",
					matchedAlias: row.matchedAlias,
					sourceQuery: sourceStep.query,
					sourceQueryPurpose: sourceStep.purpose,
				},
			},
			metadata: {
				page: row.page,
				sourceAgent: {
					id: args.config.id,
					processModel: args.fallbackFrom
						? "lambda-bedrock-converse-with-deterministic-fallback"
						: "deterministic-retrieval",
					toolAllowlist: args.config.toolAllowlist,
					retrievalStrategy: "agentic-hybrid-wiki-navigation",
					plan,
					inspectedPageCount,
					fallback: !!args.fallbackFrom,
					fallbackReason,
					trace: args.fallbackFrom?.trace,
				},
			},
		})),
	};
}

function modelResultToHit(args: {
	row: UserWikiSearchResult;
	result: SourceAgentFinalResult;
	index: number;
	request: ContextEngineProviderRequest;
	providerId: string;
	promptRef: string;
	toolAllowlist: string[];
	depthCap: number;
	agentRun: SourceAgentRunResult;
}): ContextHit {
	const confidence = args.result.confidence ?? 0.85;
	return {
		id: `wiki-agent:${args.row.page.id}`,
		providerId: args.providerId,
		family: "wiki",
		title: args.result.title || args.row.page.title,
		snippet: args.result.summary || args.row.page.summary || args.row.page.title,
		score: confidence + Math.max(0, 0.05 - args.index * 0.01),
		scope: args.request.scope,
		provenance: {
			label: "Company Brain page agent",
			sourceId: args.row.page.id,
			uri: `thinkwork://wiki/${args.row.page.type.toLowerCase()}/${args.row.page.slug}`,
			metadata: {
				promptRef: args.promptRef,
				toolAllowlist: args.toolAllowlist,
				depthCap: args.depthCap,
				retrievalStrategy: "source-agent-tool-loop",
				matchedAlias: args.row.matchedAlias,
				sourceToolCallIds: args.result.sourceToolCallIds,
			},
		},
		metadata: {
			page: args.row.page,
			sourceAgent: {
				id: args.providerId,
				processModel: "lambda-bedrock-converse",
				retrievalStrategy: "source-agent-tool-loop",
				toolAllowlist: args.toolAllowlist,
				model: args.agentRun.model,
				toolCallCount: args.agentRun.toolCallCount,
				trace: args.agentRun.trace,
				observedSourceIds: args.agentRun.observedSourceIds,
				sourceToolCallIds: args.result.sourceToolCallIds,
			},
		},
	};
}

function buildWikiSourceAgentSystemPrompt(
	config: SubAgentContextProviderConfig,
): string {
	return [
		"You are a Company Brain Page Agent inspired by Scout-style source specialists.",
		"Your job is to navigate only compiled Company Brain pages and return cited page results.",
		"Use the source-local tools iteratively: search first, then read any promising page when the snippet is not enough.",
		"Repair obvious query typos before giving up. Common repairs include restarant/restraunt/resturant/restaraunt -> restaurant and favourite/fav -> favorite.",
		"Prefer pages whose title, alias, summary, body, or cited sections directly support the user's question.",
		"Never cite a page that was not returned by a tool observation in this run.",
		"",
		`Prompt ref: ${config.promptRef}`,
		config.prompt
			? [
					`Prompt title: ${config.prompt.title}`,
					`Prompt summary: ${config.prompt.summary}`,
					...(config.prompt.instructions ?? []).map(
						(instruction) => `Instruction: ${instruction}`,
					),
				].join("\n")
			: "",
		"",
		"Resources:",
		...(config.resources ?? []).map(
			(resource) =>
				`- ${resource.label} (${resource.type}, ${resource.access}): ${resource.description}`,
		),
		"",
		"Skills:",
		...(config.skills ?? []).map(
			(skill) => `- ${skill.label}: ${skill.description}`,
		),
	].join("\n");
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
