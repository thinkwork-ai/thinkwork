/**
 * External Memory Compounding resolvers (THINK-193 U2) — operator-only
 * inspection and control surface for external memory sources. Every
 * operation is tenant-admin gated.
 */

import { memoryProcessorConfigs } from "./memoryProcessorConfigs.query.js";
import { personalMemoryAutomation } from "./personalMemoryAutomation.query.js";
import { memorySourceConfigs } from "./memorySourceConfigs.query.js";
import { memorySourceAuthorizations } from "./memorySourceAuthorizations.query.js";
import { memoryEvidenceItems } from "./memoryEvidenceItems.query.js";
import { memoryClaims } from "./memoryClaims.query.js";
import { memoryRetractionAttempts } from "./memoryRetractionAttempts.query.js";
import { grantMemorySourceAuthorization } from "./grantMemorySourceAuthorization.mutation.js";
import { revokeMemorySourceAuthorization } from "./revokeMemorySourceAuthorization.mutation.js";
import { retractMemoryDerivation } from "./retractMemoryDerivation.mutation.js";
import { eraseMemorySource } from "./eraseMemorySource.mutation.js";
import { retryMemoryRetractionAttempt } from "./retryMemoryRetractionAttempt.mutation.js";
import { ensureSharedMemoryWorkflow } from "./ensureSharedMemoryWorkflow.mutation.js";
import { setPersonalMemoryAutomationSchedule } from "./setPersonalMemoryAutomationSchedule.mutation.js";

export const memorySourceQueries = {
  personalMemoryAutomation,
  memoryProcessorConfigs,
  memorySourceConfigs,
  memorySourceAuthorizations,
  memoryEvidenceItems,
  memoryClaims,
  memoryRetractionAttempts,
};

export const memorySourceMutations = {
  ensureSharedMemoryWorkflow,
  setPersonalMemoryAutomationSchedule,
  grantMemorySourceAuthorization,
  revokeMemorySourceAuthorization,
  retractMemoryDerivation,
  eraseMemorySource,
  retryMemoryRetractionAttempt,
};
