import { searchWikiForUser } from "../../wiki/search.js";
import type {
	ContextHit,
	ContextProviderDescriptor,
	ContextProviderResult,
} from "../types.js";

const WIKI_LIMIT = 20;

export function createWikiContextProvider(): ContextProviderDescriptor {
	return {
		id: "wiki",
		family: "wiki",
		displayName: "Company Brain Pages",
		defaultEnabled: true,
		supportedScopes: ["personal", "auto"],
		async query(request): Promise<ContextProviderResult> {
			if (!request.caller.userId) {
				return {
					hits: [],
					status: {
						state: "skipped",
						reason: "user scope is required for wiki search",
					},
				};
			}

			const rows = await searchWikiForUser({
				tenantId: request.caller.tenantId,
				userId: request.caller.userId,
				query: request.query,
				limit: Math.min(request.limit, WIKI_LIMIT),
			});

			return {
				hits: rows.map((row): ContextHit => ({
					id: `wiki:${row.page.id}`,
					providerId: "wiki",
					family: "wiki",
					title: row.page.title,
					snippet: row.page.summary || row.page.title,
					score: row.score,
					scope: request.scope,
					provenance: {
						label: `Wiki ${row.page.type}`,
						sourceId: row.page.id,
						uri: `thinkwork://wiki/${row.page.type}/${row.page.slug}`,
						metadata: {
							type: row.page.type,
							slug: row.page.slug,
							matchedAlias: row.matchedAlias,
						},
					},
					metadata: {
						page: row.page,
					},
				})),
			};
		},
	};
}
