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
import { identityMatchJob } from "./identityMatchJob.query.js";
import { registerIdentitySource } from "./registerIdentitySource.mutation.js";
import { resolveEntities } from "./resolveEntities.query.js";
import { resolveEntityResolutionCase } from "./resolveEntityResolutionCase.mutation.js";
import { startIdentityMatchJob } from "./startIdentityMatchJob.mutation.js";
import {
  authorEntitySourceMapping,
  canonicalEntitySplitPreview,
  revokeEntitySourceMapping,
  splitCanonicalEntity,
} from "./stewardship.mutation.js";

export const entityIdentityQueries = {
  canonicalEntities,
  canonicalEntity,
  entityResolutionCases,
  entityResolutionCase,
  canonicalEntityMergePreview,
  // THINK-321 U8 split preview (tenant-admin gated, echo contract).
  canonicalEntitySplitPreview,
  // THINK-321 U5 agent routing read (turn-bound for service callers).
  resolveEntities,
  // THINK-321 U7 bootstrap/drift match job polling.
  identityMatchJob,
};

export const entityIdentityMutations = {
  resolveEntityResolutionCase,
  mergeCanonicalEntities,
  // THINK-321 U5 consent-bound routing writes (turn-bound for service
  // callers; the consent echo check lives in the U2 routing lib).
  proposeMappingCandidates,
  confirmEntityMapping,
  declineEntityMappingCandidates,
  // THINK-321 U7 identity-source registration + match jobs.
  registerIdentitySource,
  startIdentityMatchJob,
  // THINK-321 U8 operator stewardship (tenant-admin gated ONLY — never the
  // turn-bound service path; agent write-asymmetry is deliberate).
  authorEntitySourceMapping,
  revokeEntitySourceMapping,
  splitCanonicalEntity,
};
