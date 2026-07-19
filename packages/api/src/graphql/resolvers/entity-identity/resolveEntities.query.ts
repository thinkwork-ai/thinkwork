/**
 * `resolveEntities` — bulk-first crosswalk resolve for the agent routing
 * path (THINK-321 U5, R1/R2). Turn-bound for service callers
 * (routing-auth.ts), tenant-admin gated otherwise. Delegates to the U2
 * routing lib; this resolver only coerces the GraphQL input shape into the
 * lib's tagged EntityRef union.
 */

import type { GraphQLContext } from "../../context.js";
import {
  resolveEntities as resolveEntitiesLib,
  type EntityRef,
} from "../../../lib/entity-identity/routing.js";
import { resolveIdentityRoutingScope } from "./routing-auth.js";

export interface EntityRefInput {
  canonicalId?: string | null;
  sourceSystem?: string | null;
  namespace?: string | null;
  externalId?: string | null;
  name?: string | null;
  entityTypeSlug?: string | null;
}

/**
 * Coerce one GraphQL ref input into the routing lib's tagged union.
 * Precedence: canonicalId, then (sourceSystem, externalId), then
 * (name, entityTypeSlug). Anything else becomes an empty shape the lib
 * reports as an explicit invalid_ref miss — never silently dropped.
 */
export function coerceEntityRef(input: EntityRefInput): EntityRef {
  if (typeof input.canonicalId === "string" && input.canonicalId.trim()) {
    return { canonicalId: input.canonicalId.trim() };
  }
  if (
    typeof input.sourceSystem === "string" &&
    input.sourceSystem.trim() &&
    typeof input.externalId === "string" &&
    input.externalId.trim()
  ) {
    return {
      sourceSystem: input.sourceSystem.trim(),
      namespace:
        typeof input.namespace === "string" && input.namespace.trim()
          ? input.namespace.trim()
          : undefined,
      externalId: input.externalId.trim(),
    };
  }
  if (
    typeof input.name === "string" &&
    input.name.trim() &&
    typeof input.entityTypeSlug === "string" &&
    input.entityTypeSlug.trim()
  ) {
    return {
      name: input.name.trim(),
      entityTypeSlug: input.entityTypeSlug.trim(),
    };
  }
  return {} as EntityRef;
}

export interface ResolveEntitiesArgs {
  tenantId?: string | null;
  refs: EntityRefInput[];
  targetSystems?: string[] | null;
  page?: number | null;
  limit?: number | null;
}

export async function resolveEntities(
  _parent: unknown,
  args: ResolveEntitiesArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveIdentityRoutingScope(ctx, args);
  const result = await resolveEntitiesLib(ctx.db, {
    tenantId: scope.tenantId,
    refs: (args.refs ?? []).map(coerceEntityRef),
    targetSystems: args.targetSystems ?? undefined,
    page: args.page ?? undefined,
    limit: args.limit ?? undefined,
  });
  return {
    results: result.results.map((entry) => ({
      status: entry.status,
      unroutable: entry.status === "miss" ? entry.unroutable : null,
      entity: entry.status === "hit" ? entry.entity : null,
    })),
    page: result.page,
    limit: result.limit,
    totalRefs: result.totalRefs,
    hasMore: result.hasMore,
  };
}
