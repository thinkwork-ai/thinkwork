/**
 * `knowledgeGraphGetEntity` / `knowledgeGraphNeighbors` — agent-facing
 * traversal companions to `knowledgeGraphSearch` (THINK-133 U6). Tenant
 * scope resolves turn-bound for service callers (search-auth.ts), NOT the
 * admin Explorer scope; results carry NO evidence snippets (R17).
 */

import type { GraphQLContext } from "../../context.js";
import {
  getKnowledgeGraphEntityDetail,
  getKnowledgeGraphNeighbors,
} from "../../../lib/knowledge-graph/graph-traverse.js";
import { resolveKnowledgeGraphSearchScope } from "./search-auth.js";

export interface KnowledgeGraphGetEntityArgs {
  tenantId?: string | null;
  entityId: string;
}

export async function knowledgeGraphGetEntity(
  _parent: unknown,
  args: KnowledgeGraphGetEntityArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return getKnowledgeGraphEntityDetail({
    db: ctx.db,
    tenantId: scope.tenantId,
    entityId: args.entityId,
  });
}

export interface KnowledgeGraphNeighborsArgs {
  tenantId?: string | null;
  entityId: string;
  depth?: number | null;
}

export async function knowledgeGraphNeighbors(
  _parent: unknown,
  args: KnowledgeGraphNeighborsArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return getKnowledgeGraphNeighbors({
    db: ctx.db,
    tenantId: scope.tenantId,
    entityId: args.entityId,
    depth: args.depth,
  });
}
