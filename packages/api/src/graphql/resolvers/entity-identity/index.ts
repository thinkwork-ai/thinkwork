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
  canonicalEntityMergePreview,
  mergeCanonicalEntities,
} from "./mergeCanonicalEntities.mutation.js";
import { resolveEntityResolutionCase } from "./resolveEntityResolutionCase.mutation.js";

export const entityIdentityQueries = {
  canonicalEntities,
  canonicalEntity,
  entityResolutionCases,
  entityResolutionCase,
  canonicalEntityMergePreview,
};

export const entityIdentityMutations = {
  resolveEntityResolutionCase,
  mergeCanonicalEntities,
};
