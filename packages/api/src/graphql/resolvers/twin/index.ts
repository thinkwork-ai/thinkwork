/**
 * Twin read queries (Company Brain U6). Tenant scope resolves turn-bound
 * for service callers — the same discipline as the knowledge-graph agent
 * queries (search-auth.ts): the Pi provider sends a turn reference, never a
 * tenant assertion. Requests are TYPED (the query compiler refuses anything
 * else inside the VPC boundary); results are JSON payloads carrying
 * per-fact provenance the U7 tool layer formats.
 */

import type { GraphQLContext } from "../../context.js";
import { resolveKnowledgeGraphSearchScope } from "../knowledge-graph/search-auth.js";
import { executeTwinQuery } from "../../../lib/twin/client.js";
import type {
  TwinPath,
  TwinPredicate,
} from "../../../lib/twin/query-compiler.js";

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function twinEntity(
  _parent: unknown,
  args: { tenantId?: string | null; canonicalId: string },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return executeTwinQuery({
    tenantId: scope.tenantId,
    request: { kind: "entity_get", canonicalId: args.canonicalId },
  });
}

export async function twinNeighbors(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    canonicalId: string;
    depth?: number | null;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return executeTwinQuery({
    tenantId: scope.tenantId,
    request: {
      kind: "neighbors",
      canonicalId: args.canonicalId,
      depth: args.depth ?? undefined,
    },
  });
}

export async function twinSystemEdges(
  _parent: unknown,
  args: { tenantId?: string | null; canonicalId: string },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return executeTwinQuery({
    tenantId: scope.tenantId,
    request: { kind: "system_edges", canonicalId: args.canonicalId },
  });
}

export async function twinCohort(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    entityType: string;
    filter: unknown;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  // The filter is a TYPED structure (predicates + optional path); the
  // compiler inside the VPC Lambda validates every slug and re-parameterizes
  // every value — a malformed filter comes back invalid_request, never
  // reaches query text.
  const filter = (parseJson(args.filter) ?? {}) as {
    predicates?: TwinPredicate[];
    path?: TwinPath;
  };
  return executeTwinQuery({
    tenantId: scope.tenantId,
    request: {
      kind: "cohort",
      entityType: args.entityType,
      predicates: Array.isArray(filter.predicates) ? filter.predicates : [],
      path: filter.path,
      limit: args.limit ?? undefined,
    },
  });
}

export const twinQueries = {
  twinEntity,
  twinNeighbors,
  twinSystemEdges,
  twinCohort,
};
