/**
 * External Memory Compounding resolvers (THINK-193 U2) — operator-only
 * inspection and control surface for external memory sources. Every
 * operation is tenant-admin gated.
 */

import { memoryProcessorConfigs } from "./memoryProcessorConfigs.query.js";
import { memorySourceConfigs } from "./memorySourceConfigs.query.js";
import { memorySourceAuthorizations } from "./memorySourceAuthorizations.query.js";
import { memoryEvidenceItems } from "./memoryEvidenceItems.query.js";
import { memoryClaims } from "./memoryClaims.query.js";
import { memoryRetractionAttempts } from "./memoryRetractionAttempts.query.js";
import { grantMemorySourceAuthorization } from "./grantMemorySourceAuthorization.mutation.js";
import { revokeMemorySourceAuthorization } from "./revokeMemorySourceAuthorization.mutation.js";
import { retractMemoryDerivation } from "./retractMemoryDerivation.mutation.js";
import { eraseMemorySource } from "./eraseMemorySource.mutation.js";

export const memorySourceQueries = {
  memoryProcessorConfigs,
  memorySourceConfigs,
  memorySourceAuthorizations,
  memoryEvidenceItems,
  memoryClaims,
  memoryRetractionAttempts,
};

export const memorySourceMutations = {
  grantMemorySourceAuthorization,
  revokeMemorySourceAuthorization,
  retractMemoryDerivation,
  eraseMemorySource,
};
