/**
 * Guarded merge + preview (THINK-193 U4). Tenant-admin gated. The preview is
 * a separate query; the mutation requires the operator to echo it back and
 * aborts on drift (merge.ts recomputes inside the transaction).
 */

import { nudgeIdentityGraphProjector } from "../../../lib/entity-identity/graph-projection.js";
import type { GraphQLContext } from "../../context.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  computeMergeImpact,
  mergeCanonicalEntities as mergeCanonicalEntitiesLib,
  type MergeImpactPreview,
} from "../../../lib/entity-identity/merge.js";
import { db } from "../../../lib/db.js";
import { resolveTenantId } from "./canonicalEntities.query.js";

export async function canonicalEntityMergePreview(
  _parent: unknown,
  args: { tenantId?: string | null; survivorId: string; loserId: string },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  return computeMergeImpact(ctx.db, {
    tenantId,
    survivorId: args.survivorId,
    loserId: args.loserId,
  });
}

interface MergeArgs {
  tenantId?: string | null;
  survivorId: string;
  loserId: string;
  confirmImpact: MergeImpactPreview;
}

export async function mergeCanonicalEntities(
  _parent: unknown,
  args: MergeArgs,
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  const confirmImpact: MergeImpactPreview = {
    sourceMappingCount: args.confirmImpact.sourceMappingCount,
    identityClaimCount: args.confirmImpact.identityClaimCount,
    memoryClaimCount: args.confirmImpact.memoryClaimCount,
    graphEntityCount: args.confirmImpact.graphEntityCount,
  };
  const result = await mergeCanonicalEntitiesLib(db, {
    tenantId,
    survivorId: args.survivorId,
    loserId: args.loserId,
    actorUserId,
    confirmImpact,
  });
  // Company Brain U5 (KTD-4): the merge committed — nudge the twin graph
  // projector (fire-and-forget; the cursor makes a missed nudge harmless).
  await nudgeIdentityGraphProjector(tenantId);
  return result;
}
