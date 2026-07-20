/**
 * Canonical identity resolvers (THINK-193 U4) — operator-only stewardship of
 * the identity registry and resolution queue. Every operation is
 * tenant-admin gated (see canonicalEntities.query.ts resolveTenantId).
 */

import {
  canonicalEntities,
  canonicalEntity,
} from "./canonicalEntities.query.js";
import {
  entityResolutionCase,
  entityResolutionCases,
} from "./entityResolutionCases.query.js";
import {
  confirmEntityMapping,
  declineEntityMappingCandidates,
  proposeMappingCandidates,
} from "./mappingCandidates.mutation.js";
import {
  canonicalEntityMergePreview,
  mergeCanonicalEntities,
} from "./mergeCanonicalEntities.mutation.js";
import { resolveEntities } from "./resolveEntities.query.js";
import { resolveEntityResolutionCase } from "./resolveEntityResolutionCase.mutation.js";

export const entityIdentityQueries = {
  canonicalEntities,
  canonicalEntity,
  entityResolutionCases,
  entityResolutionCase,
  canonicalEntityMergePreview,
  // THINK-321 U5 agent routing read (turn-bound for service callers).
  resolveEntities,
};

export const entityIdentityMutations = {
  resolveEntityResolutionCase,
  mergeCanonicalEntities,
  // THINK-321 U5 consent-bound routing writes (turn-bound for service
  // callers; the consent echo check lives in the U2 routing lib).
  proposeMappingCandidates,
  confirmEntityMapping,
  declineEntityMappingCandidates,
};
