/**
 * search — THINK-263 unified fan-out over the tenant brain's retrieval legs.
 *
 * Thin GraphQL shim over `lib/search/broker.ts` (KTD-1): resolves the
 * caller's identity and wiki read scope, then delegates. The Pi agent tool
 * calls the same broker module, so retrieval improvements land on both
 * surfaces at once (R2).
 */

import type { GraphQLContext } from "../../context.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { resolveWikiUnionReadScope } from "../wiki/auth.js";
import { searchBroker, type SearchSource } from "../../../lib/search/broker.js";
import { resolveServiceSearchScope } from "./search-auth.js";

const DEFAULT_LIMIT = 10;

export const search = async (
  _parent: unknown,
  args: {
    tenantId: string;
    query: string;
    sources?: SearchSource[] | null;
    limit?: number | null;
    queryId?: string | null;
  },
  ctx: GraphQLContext,
) => {
  const authType = ctx.auth?.authType;

  // Service callers are the Pi agent tool (THINK-263 U8): derive tenant AND
  // the turn's user server-side from the turn-bound header so the broker runs
  // with the same per-user thread/memory scope the user sees in the palette.
  if (authType === "service") {
    const { tenantId, userId } = await resolveServiceSearchScope(ctx, {
      tenantId: args.tenantId,
    });
    return searchBroker({
      tenantId,
      callerUserId: userId,
      query: args.query,
      sources: args.sources ?? [],
      limit: args.limit ?? DEFAULT_LIMIT,
      wikiScope: { kind: "tenantUnion", userId },
      queryId: args.queryId ?? null,
    });
  }

  let callerUserId: string | null = null;
  if (authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) {
      return { queryId: args.queryId || "denied", legs: [] };
    }
    callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return { queryId: args.queryId || "denied", legs: [] };
  }

  const { scope } = await resolveWikiUnionReadScope(ctx, {
    tenantId: args.tenantId,
  });

  return searchBroker({
    tenantId: args.tenantId,
    callerUserId,
    query: args.query,
    sources: args.sources ?? [],
    limit: args.limit ?? DEFAULT_LIMIT,
    wikiScope: scope,
    queryId: args.queryId ?? null,
  });
};
