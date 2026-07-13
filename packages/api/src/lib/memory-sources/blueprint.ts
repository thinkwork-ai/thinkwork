/**
 * Memory Workflow blueprint seam (THINK-193 U3).
 *
 * The blueprint DEFINITIONS live in @thinkwork/agent-loops-core
 * (memory-blueprint.ts) and the lazy version ensure lives in
 * @thinkwork/database-pg (workflow-blueprint-db.ts) so packages/lambda
 * (job-trigger's scheduled path) can consume them without crossing the
 * lambda -> api boundary. This module re-exports them at the plan-named
 * api location for api-side consumers.
 */

export {
  buildPersonalMemoryWorkflowDefinition,
  buildSharedMemoryWorkflowDefinition,
  matchesMemoryBlueprint,
  memoryBlueprintFor,
  memoryBlueprintSourceMetadata,
  isToggleableMemoryStage,
  normalizeDisabledStages,
  MEMORY_BLUEPRINT_VERSION,
  PERSONAL_MEMORY_BLUEPRINT_KEY,
  SHARED_MEMORY_BLUEPRINT_KEY,
  TOGGLEABLE_MEMORY_STAGES,
  type MemoryBlueprint,
  type MemoryBlueprintKey,
  type MemoryBlueprintSourceMetadata,
  type MemoryStageOverrides,
  type ToggleableMemoryStage,
} from "@thinkwork/agent-loops-core";

export {
  ensureMemoryBlueprintVersion,
  findMemoryProcessorForWorkflow,
  type EnsureMemoryBlueprintResult,
} from "@thinkwork/database-pg";
