import { searchWikiForReadScope } from "../../wiki/search.js";
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
    sourceFamily: "pages",
    displayName: "ThinkWork Brain Pages",
    defaultEnabled: true,
    supportedScopes: ["personal", "auto"],
    async query(request): Promise<ContextProviderResult> {
      // Tenant-union scope (plan 2026-06-09-004 U14): tenant-scoped pages
      // (graph materializer output, owner NULL) plus the requesting
      // user's own pages. Without this the provider returns nothing after
      // the graph cutover — tenant pages have no owner to match. Callers
      // with no user in scope still get the tenant-shared pages.
      const rows = await searchWikiForReadScope({
        tenantId: request.caller.tenantId,
        scope: {
          kind: "tenantUnion",
          userId: request.caller.userId ?? null,
        },
        query: request.query,
        limit: Math.min(request.limit, WIKI_LIMIT),
      });

      return {
        hits: rows.map(
          (row): ContextHit => ({
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
          }),
        ),
      };
    },
  };
}
