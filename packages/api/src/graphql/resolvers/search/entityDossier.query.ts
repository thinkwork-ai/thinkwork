/**
 * entityDossier — THINK-263 U5 server-assembled view of one grounded
 * knowledge-graph entity (wiki page + memories + threads + artifacts).
 *
 * Thin GraphQL shim over `lib/search/entity-dossier.ts`, mirroring
 * `search.query.ts`: resolve the caller's identity and wiki read scope, then
 * delegate. The assembly fences every thread-derived surface behind the
 * caller's thread visibility, so the resolver only supplies who the caller is.
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { resolveWikiUnionReadScope } from "../wiki/auth.js";
import {
  assembleEntityDossier,
  type EntityDossierResult,
} from "../../../lib/search/entity-dossier.js";
import { resolveServiceSearchScope } from "./search-auth.js";

const DEFAULT_LIMIT = 10;

export const entityDossier = async (
  _parent: unknown,
  args: {
    tenantId: string;
    query: string;
    entityId?: string | null;
  },
  ctx: GraphQLContext,
): Promise<EntityDossierResult> => {
  const authType = ctx.auth?.authType;

  // Service callers are the Pi agent tool: derive tenant AND the turn's user
  // server-side so the dossier runs with the same per-user thread/memory scope
  // the user sees, and a prompt-injected turn cannot widen scope by parameter.
  if (authType === "service") {
    const { tenantId, userId } = await resolveServiceSearchScope(ctx, {
      tenantId: args.tenantId,
    });
    return assembleEntityDossier({
      db: ctx.db,
      tenantId,
      query: args.query,
      entityId: args.entityId ?? null,
      callerUserId: userId,
      wikiScope: { kind: "tenantUnion", userId },
      limit: DEFAULT_LIMIT,
    });
  }

  let callerUserId: string | null = null;
  if (authType === "cognito") {
    const callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId || callerTenantId !== args.tenantId) {
      throw new GraphQLError("Access denied: tenant mismatch", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    callerUserId = await resolveCallerUserId(ctx);
  }

  const { scope } = await resolveWikiUnionReadScope(ctx, {
    tenantId: args.tenantId,
  });

  return assembleEntityDossier({
    db: ctx.db,
    tenantId: args.tenantId,
    query: args.query,
    entityId: args.entityId ?? null,
    callerUserId,
    wikiScope: scope,
    limit: DEFAULT_LIMIT,
  });
};
