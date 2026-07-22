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
import { projectEntityPage } from "../../../lib/twin/page-projection.js";
import {
  dismissMaterializationSuggestion,
  listMaterializationSuggestions,
  recordMaterializationSuggestion,
} from "../../../lib/twin/suggestions.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

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
    nameContains?: string;
    path?: TwinPath;
  };
  return executeTwinQuery({
    tenantId: scope.tenantId,
    request: {
      kind: "cohort",
      entityType: args.entityType,
      predicates: Array.isArray(filter.predicates) ? filter.predicates : [],
      nameContains:
        typeof filter.nameContains === "string"
          ? filter.nameContains
          : undefined,
      path: filter.path,
      limit: args.limit ?? undefined,
    },
  });
}

export async function twinEntityPage(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    entityType: string;
    canonicalId: string;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  const viewerUserId = (await resolveCallerUserId(ctx)) ?? undefined;
  // Operator visibility resolves server-side: admins see operators_only
  // sections, everyone else does not (R14).
  let viewerIsOperator = false;
  try {
    await requireAdminOrServiceCaller(ctx, scope.tenantId, "twin_entity_page");
    viewerIsOperator = true;
  } catch {
    viewerIsOperator = false;
  }
  return projectEntityPage({
    tenantId: scope.tenantId,
    entityTypeSlug: args.entityType,
    canonicalId: args.canonicalId,
    viewerIsOperator,
    viewerUserId,
  });
}

export async function twinMaterializationSuggestions(
  _parent: unknown,
  args: { tenantId?: string | null },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  await requireAdminOrServiceCaller(
    ctx,
    scope.tenantId,
    "twin_materialization_suggestions",
  );
  return listMaterializationSuggestions({ tenantId: scope.tenantId });
}

export async function recordTwinMaterializationSuggestion(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    entityTypeSlug: string;
    facetSlug: string;
    question?: string | null;
  },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  return recordMaterializationSuggestion({
    tenantId: scope.tenantId,
    entityTypeSlug: args.entityTypeSlug,
    facetSlug: args.facetSlug,
    question: args.question ?? null,
  });
}

export async function dismissTwinMaterializationSuggestion(
  _parent: unknown,
  args: { tenantId?: string | null; suggestionId: string },
  ctx: GraphQLContext,
) {
  const scope = await resolveKnowledgeGraphSearchScope(ctx, args);
  await requireAdminOrServiceCaller(
    ctx,
    scope.tenantId,
    "dismiss_twin_materialization_suggestion",
  );
  return dismissMaterializationSuggestion({
    tenantId: scope.tenantId,
    suggestionId: args.suggestionId,
  });
}

export const twinQueries = {
  twinEntity,
  twinNeighbors,
  twinSystemEdges,
  twinCohort,
  twinEntityPage,
  twinMaterializationSuggestions,
};

export const twinMutations = {
  recordTwinMaterializationSuggestion,
  dismissTwinMaterializationSuggestion,
};
