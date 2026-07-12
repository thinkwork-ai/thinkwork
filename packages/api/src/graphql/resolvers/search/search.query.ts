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
