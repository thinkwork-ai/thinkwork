/**
 * Operator stewardship verbs (THINK-321 U8, KTD-8): hand-author a crosswalk
 * link, revoke a mapping, and split a wrongly merged canonical entity —
 * plus the split-impact preview the confirm must echo.
 *
 * Every operation is tenant-admin gated via `resolveTenantId` (the merge
 * precedent). Deliberately NOT wired through routing-auth's turn-bound
 * service path: agent write-asymmetry is a feature of the trust model —
 * only operators author, revoke, and split (plan Definition of Done: "No
 * agent-reachable merge/split/revoke surface exists").
 */

import type { GraphQLContext } from "../../context.js";
import { nudgeIdentityGraphProjector } from "../../../lib/entity-identity/graph-projection.js";
import {
  authorEntitySourceMapping as authorEntitySourceMappingLib,
  revokeEntitySourceMapping as revokeEntitySourceMappingLib,
} from "../../../lib/entity-identity/routing.js";
import {
  previewCanonicalEntitySplit,
  splitCanonicalEntity as splitCanonicalEntityLib,
  type SplitImpactPreview,
  type SplitMappingAssignment,
} from "../../../lib/entity-identity/split.js";
import { db } from "../../../lib/db.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { resolveTenantId } from "./canonicalEntities.query.js";

interface SplitAssignmentInput {
  mappingId: string;
  half: "a" | "b";
}

interface SplitImpactInput {
  mappingCountA: number;
  mappingCountB: number;
  claimCountFollowingB: number;
  claimCountRemainingA: number;
  memoryClaimCount: number;
}

function toSplitImpact(input: SplitImpactInput): SplitImpactPreview {
  return {
    mappingCountA: input.mappingCountA,
    mappingCountB: input.mappingCountB,
    claimCountFollowingB: input.claimCountFollowingB,
    claimCountRemainingA: input.claimCountRemainingA,
    memoryClaimCount: input.memoryClaimCount,
  };
}

function toAssignments(
  assignments: SplitAssignmentInput[],
): SplitMappingAssignment[] {
  return assignments.map((assignment) => ({
    mappingId: assignment.mappingId,
    half: assignment.half,
  }));
}

export async function canonicalEntitySplitPreview(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    canonicalEntityId: string;
    assignments: SplitAssignmentInput[];
  },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  return previewCanonicalEntitySplit(ctx.db, {
    tenantId,
    canonicalEntityId: args.canonicalEntityId,
    assignments: toAssignments(args.assignments),
  });
}

export async function splitCanonicalEntity(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    canonicalEntityId: string;
    assignments: SplitAssignmentInput[];
    newEntityDisplayName: string;
    confirmImpact: SplitImpactInput;
  },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await splitCanonicalEntityLib(db, {
    tenantId,
    canonicalEntityId: args.canonicalEntityId,
    assignments: toAssignments(args.assignments),
    newEntityDisplayName: args.newEntityDisplayName,
    actorUserId,
    confirmImpact: toSplitImpact(args.confirmImpact),
  });
  // Company Brain U5 (KTD-4): split committed — nudge the twin projector.
  await nudgeIdentityGraphProjector(tenantId);
  return result;
}

export async function authorEntitySourceMapping(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    canonicalEntityId: string;
    sourceSystem: string;
    namespace?: string | null;
    externalId: string;
  },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await authorEntitySourceMappingLib(ctx.db, {
    tenantId,
    canonicalEntityId: args.canonicalEntityId,
    sourceSystem: args.sourceSystem,
    namespace: args.namespace ?? "",
    externalId: args.externalId,
    actorUserId,
  });
  if (result.status === "created") {
    // Company Brain U5 (KTD-4): mapping committed — nudge the twin projector.
    await nudgeIdentityGraphProjector(tenantId);
    return {
      status: result.status,
      reason: null,
      mapping: {
        id: result.mapping.id,
        canonicalEntityId: result.mapping.canonicalEntityId,
        sourceSystem: result.mapping.sourceSystem,
        namespace: result.mapping.namespace,
        externalId: result.mapping.externalId,
        visibility: result.mapping.visibility,
        createdBy: result.mapping.createdBy,
        createdByUserId: actorUserId,
        createdThreadRef: null,
        createdAt: null,
      },
      existingMappingId: null,
      existingCanonicalEntityId: null,
    };
  }
  if (result.status === "already_linked") {
    return {
      status: result.status,
      reason: null,
      mapping: null,
      existingMappingId: result.existingMappingId || null,
      existingCanonicalEntityId: result.existingCanonicalEntityId || null,
    };
  }
  return {
    status: result.status,
    reason: result.reason,
    mapping: null,
    existingMappingId: null,
    existingCanonicalEntityId: null,
  };
}

export async function revokeEntitySourceMapping(
  _parent: unknown,
  args: { tenantId?: string | null; mappingId: string; reason?: string | null },
  ctx: GraphQLContext,
) {
  const tenantId = await resolveTenantId(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await revokeEntitySourceMappingLib(ctx.db, {
    tenantId,
    mappingId: args.mappingId,
    actor: { createdBy: "operator", userId: actorUserId },
    reason: args.reason?.trim() || undefined,
  });
  if (result.status === "revoked") {
    // Company Brain U5 (KTD-4): revoke committed — nudge the twin projector.
    await nudgeIdentityGraphProjector(tenantId);
    return {
      status: result.status,
      reason: null,
      canonicalEntityId: result.canonicalEntityId,
      sourceSystem: result.sourceSystem,
      namespace: result.namespace,
      externalId: result.externalId,
    };
  }
  return {
    status: result.status,
    reason: result.reason,
    canonicalEntityId: null,
    sourceSystem: null,
    namespace: null,
    externalId: null,
  };
}
