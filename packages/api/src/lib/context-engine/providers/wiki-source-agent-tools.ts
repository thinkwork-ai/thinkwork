import type { UserWikiSearchResult } from "../../wiki/search.js";
import type { SourceAgentTool } from "./source-agent-runtime.js";

export interface WikiSourceAgentToolSet {
	tools: SourceAgentTool[];
	getPage(pageId: string): UserWikiSearchResult | undefined;
	getSearches(): Array<{ query: string; rows: UserWikiSearchResult[] }>;
}

export function createWikiSourceAgentTools(args: {
	tenantId: string;
	userId: string;
	defaultLimit: number;
	search: (args: {
		tenantId: string;
		userId: string;
		query: string;
		limit: number;
	}) => Promise<UserWikiSearchResult[]>;
}): WikiSourceAgentToolSet {
	const pages = new Map<string, UserWikiSearchResult>();
	const searches: Array<{ query: string; rows: UserWikiSearchResult[] }> = [];

	const searchTool: SourceAgentTool = {
		name: "company-brain.pages.search",
		description:
			"Search active compiled Company Brain pages with lexical, prefix, alias, and typo-tolerant matching.",
		async execute(input, context) {
			const query = stringInput(input.query) ?? context.query;
			const limit = positiveIntInput(input.limit) ?? args.defaultLimit;
			const rows = await args.search({
				tenantId: args.tenantId,
				userId: args.userId,
				query,
				limit,
			});
			searches.push({ query, rows });
			for (const row of rows) {
				pages.set(row.page.id, row);
				context.rememberSource(row.page.id, row);
			}
			return {
				summary: `searched "${query}" and found ${rows.length} compiled page${
					rows.length === 1 ? "" : "s"
				}`,
				citedSourceIds: rows.map((row) => row.page.id),
				observation: {
					query,
					pages: rows.map((row) => ({
						id: row.page.id,
						title: row.page.title,
						type: row.page.type,
						slug: row.page.slug,
						summary: row.page.summary,
						score: row.score,
						matched_alias: row.matchedAlias,
					})),
				},
			};
		},
	};

	const readTool: SourceAgentTool = {
		name: "company-brain.pages.read",
		description:
			"Read one compiled Company Brain page that was already returned by company-brain.pages.search.",
		async execute(input, context) {
			const pageId =
				stringInput(input.page_id) ??
				stringInput(input.pageId) ??
				stringInput(input.source_id) ??
				stringInput(input.sourceId);
			if (!pageId) {
				throw new Error("page_id is required");
			}
			if (!context.observedSourceIds.has(pageId)) {
				throw new Error(`page ${pageId} has not been observed by search`);
			}
			const row = pages.get(pageId) ?? context.getSource<UserWikiSearchResult>(pageId);
			if (!row) {
				throw new Error(`page ${pageId} is not available in this agent run`);
			}
			return {
				summary: `read compiled page "${row.page.title}"`,
				citedSourceIds: [row.page.id],
				observation: {
					id: row.page.id,
					title: row.page.title,
					type: row.page.type,
					slug: row.page.slug,
					summary: row.page.summary,
					body_md: row.page.bodyMd,
					aliases: row.page.aliases,
					sections: row.page.sections,
				},
			};
		},
	};

	return {
		tools: [searchTool, readTool],
		getPage(pageId) {
			return pages.get(pageId);
		},
		getSearches() {
			return searches;
		},
	};
}

function stringInput(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveIntInput(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return undefined;
	}
	return Math.floor(value);
}
