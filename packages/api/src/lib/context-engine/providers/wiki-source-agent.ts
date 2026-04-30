import { searchWikiForUser, type UserWikiSearchResult } from "../../wiki/search.js";
import type { ContextHit } from "../types.js";
import { createSubAgentContextProvider } from "./sub-agent-base.js";

const WIKI_SOURCE_AGENT_LIMIT = 10;

export type WikiSourceAgentSearch = (args: {
	tenantId: string;
	userId: string;
	query: string;
	limit: number;
}) => Promise<UserWikiSearchResult[]>;

export function createWikiSourceAgentContextProvider(options: {
	search?: WikiSourceAgentSearch;
	defaultEnabled?: boolean;
} = {}) {
	const search = options.search ?? searchWikiForUser;
	return createSubAgentContextProvider({
		id: "wiki-source-agent",
		displayName: "Company Brain Page Agent",
		sourceFamily: "pages",
		promptRef: "brain/provider/wiki-source-agent",
		toolAllowlist: ["company-brain.pages.search", "company-brain.pages.read"],
		depthCap: 2,
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

			const rows = await search({
				tenantId: request.caller.tenantId,
				userId: request.caller.userId,
				query: request.query,
				limit: Math.min(request.limit, WIKI_SOURCE_AGENT_LIMIT),
			});

			return {
				state: "ok",
				hits: rows.map((row): ContextHit => ({
					id: `wiki-agent:${row.page.id}`,
					providerId: config.id,
					family: "wiki",
					title: row.page.title,
					snippet: row.page.summary || row.page.title,
					score: row.score + 0.05,
					scope: request.scope,
					provenance: {
						label: "Company Brain page agent",
						sourceId: row.page.id,
						uri: `thinkwork://wiki/${row.page.type.toLowerCase()}/${row.page.slug}`,
						metadata: {
							promptRef: config.promptRef,
							toolAllowlist: config.toolAllowlist,
							depthCap: config.depthCap,
							retrievalStrategy: "hybrid-lexical",
							matchedAlias: row.matchedAlias,
						},
					},
					metadata: {
						page: row.page,
						sourceAgent: {
							id: config.id,
							processModel: "lambda-bedrock-converse",
							toolAllowlist: config.toolAllowlist,
							retrievalStrategy: "hybrid-lexical",
						},
					},
				})),
			};
		},
	});
}
