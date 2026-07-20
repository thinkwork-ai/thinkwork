/**
 * Consent-bound mapping mutations for the agent routing path (THINK-321
 * U5, KTD-2): `proposeMappingCandidates`, `confirmEntityMapping`,
 * `declineEntityMappingCandidates`. Turn-bound for service callers
 * (routing-auth.ts) — tenant, user, and thread derive server-side from the
 * turn reference, so confirm attribution can never be asserted by the
 * model. Tenant-admin gated otherwise (threadRef must then be supplied).
 *
 * The consent machinery itself (selection recorded at answer intake, echo
 * check, TTL, signature-deduped decline cases) is enforced in the U2
 * routing lib — these resolvers are thin passthroughs.
 */

import type { GraphQLContext } from "../../context.js";
import {
  confirmMapping,
  declineCandidates,
  proposeMappingCandidates as proposeMappingCandidatesLib,
} from "../../../lib/entity-identity/routing.js";
import {
  requireConsentUserId,
  resolveConsentThreadRef,
  resolveIdentityRoutingScope,
} from "./routing-auth.js";

export interface ProposeMappingCandidatesArgs {
  tenantId?: string | null;
  canonicalEntityId: string;
  targetSystem: string;
  threadRef?: string | null;
}

export async function proposeMappingCandidates(
  _parent: unknown,
  args: ProposeMappingCandidatesArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveIdentityRoutingScope(ctx, args);
  const threadRef = resolveConsentThreadRef(scope, args.threadRef);
  const result = await proposeMappingCandidatesLib(ctx.db, {
    tenantId: scope.tenantId,
    canonicalEntityId: args.canonicalEntityId,
    targetSystem: args.targetSystem,
    threadRef,
  });
  if (result.status === "refused") {
    return {
      status: result.status,
      reason: result.reason,
      candidateSetId: null,
      candidates: null,
      expiresAt: null,
    };
  }
  return {
    status: result.status,
    reason: null,
    candidateSetId: result.candidateSetId,
    candidates: result.candidates,
    expiresAt: result.expiresAt,
  };
}

export interface ConfirmEntityMappingArgs {
  tenantId?: string | null;
  threadRef?: string | null;
  candidateSetId: string;
  candidateId: string;
}

export async function confirmEntityMapping(
  _parent: unknown,
  args: ConfirmEntityMappingArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveIdentityRoutingScope(ctx, args);
  const threadRef = resolveConsentThreadRef(scope, args.threadRef);
  // Server-derived attribution (KTD-2): the confirming user is the turn's
  // owning user (or the admin caller) — never a mutation argument.
  const userId = requireConsentUserId(scope);
  const result = await confirmMapping(ctx.db, {
    tenantId: scope.tenantId,
    threadRef,
    candidateSetId: args.candidateSetId,
    candidateId: args.candidateId,
    userId,
  });
  if (result.status === "confirmed") {
    return {
      status: result.status,
      reason: null,
      mappingId: result.mappingId,
      canonicalEntityId: result.canonicalEntityId,
      sourceSystem: result.sourceSystem,
      namespace: result.namespace,
      externalId: result.externalId,
      existingMappingId: null,
      existingCanonicalEntityId: null,
    };
  }
  if (result.status === "already_linked") {
    return {
      status: result.status,
      reason: null,
      mappingId: null,
      canonicalEntityId: null,
      sourceSystem: null,
      namespace: null,
      externalId: null,
      existingMappingId: result.existingMappingId || null,
      existingCanonicalEntityId: result.existingCanonicalEntityId || null,
    };
  }
  return {
    status: result.status,
    reason: result.reason,
    mappingId: null,
    canonicalEntityId: null,
    sourceSystem: null,
    namespace: null,
    externalId: null,
    existingMappingId: null,
    existingCanonicalEntityId: null,
  };
}

export interface DeclineEntityMappingCandidatesArgs {
  tenantId?: string | null;
  threadRef?: string | null;
  candidateSetId: string;
}

export async function declineEntityMappingCandidates(
  _parent: unknown,
  args: DeclineEntityMappingCandidatesArgs,
  ctx: GraphQLContext,
) {
  const scope = await resolveIdentityRoutingScope(ctx, args);
  const threadRef = resolveConsentThreadRef(scope, args.threadRef);
  const userId = requireConsentUserId(scope);
  const turnRef = ctx.headers?.["x-thread-turn-id"];
  const result = await declineCandidates(ctx.db, {
    tenantId: scope.tenantId,
    threadRef,
    candidateSetId: args.candidateSetId,
    userId,
    provenance: {
      turnRef: typeof turnRef === "string" && turnRef ? turnRef : undefined,
    },
  });
  if (result.status === "refused") {
    return {
      status: result.status,
      reason: result.reason,
      caseId: null,
      coalesced: null,
    };
  }
  return {
    status: result.status,
    reason: null,
    caseId: result.caseId,
    coalesced: result.coalesced,
  };
}
