/**
 * `knowledgeGraphSearch` — agent-facing graph retrieval (plan
 * 2026-06-09-004 U7). Tenant scope resolves turn-bound for service callers
 * (see search-auth.ts); the result shape intentionally carries NO evidence
 * snippets (R17 — snippets stay admin-only in the Explorer surface).
 */

import type { GraphQLContext } from "../../context.js";
import { searchKnowledgeGraph } from "../../../lib/knowledge-graph/graph-search.js";
import { resolveKnowledgeGraphSearchScope } from "./search-auth.js";

export interface KnowledgeGraphSearchArgs {
  tenantId?: string | null;
  query: string;
  limit?: number | null;
}

export async function knowledgeGraphSearch(
  _parent: unknown,
  args: KnowledgeGraphSearchArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return searchKnowledgeGraph({
    db: ctx.db,
    tenantId: scope.tenantId,
    query: args.query,
    limit: args.limit,
  });
}
