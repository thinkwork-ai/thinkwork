/**
 * Managed Memory Workflow blueprints (THINK-193 U3).
 *
 * The personal and shared Memory Workflows are platform-owned, versioned,
 * code-owned definitions — not rows an operator hand-edits. The blueprint
 * key/version are copied into workflow_versions.source_metadata; at the next
 * run or configuration read, ensureMemoryBlueprintVersion (database-pg)
 * compares them and lazily supersedes the local immutable version. There is
 * never an atomic fan-out update across hundreds of workflow rows, and
 * in-flight runs stay pinned to the version they captured.
 *
 * Pure module: builders only. Persistence lives in
 * @thinkwork/database-pg/workflow-blueprint-db; provisioning lives in
 * packages/api/src/lib/memory-sources/provisioning.ts.
 */

import {
  WORKFLOW_DEFINITION_VERSION,
  type ApprovalWorkflowStep,
  type MemoryStageWorkflowStep,
  type WorkflowDefinition,
} from "./workflow-definition";

export const PERSONAL_MEMORY_BLUEPRINT_KEY = "personal-memory";
export const SHARED_MEMORY_BLUEPRINT_KEY = "shared-memory";

/**
 * Bump when a blueprint's step shape changes. Existing workflows adopt the
 * new version lazily at their next run/configuration read.
 */
export const MEMORY_BLUEPRINT_VERSION = 1;

export type MemoryBlueprintKey =
  | typeof PERSONAL_MEMORY_BLUEPRINT_KEY
  | typeof SHARED_MEMORY_BLUEPRINT_KEY;

/** source_metadata stamped on blueprint-managed workflow versions. */
export interface MemoryBlueprintSourceMetadata {
  blueprintKey: MemoryBlueprintKey;
  blueprintVersion: number;
  processorConfigId: string;
}

function stage(
  id: string,
  stageKind: MemoryStageWorkflowStep["stage"],
  processorConfigId: string,
): MemoryStageWorkflowStep {
  return { id, kind: "memory_stage", stage: stageKind, processorConfigId };
}

function planReview(prompt: string): ApprovalWorkflowStep {
  return {
    id: "plan-review",
    kind: "approval",
    prompt,
    // Manual runs pause for plan review; scheduled (and any other
    // non-manual) runs record a visible skipped approval and stay inside
    // the saved envelope (AE2).
    when: { triggerFamily: ["manual"] },
  };
}

/**
 * Personal blueprint: preflight → manual-only plan review → acquire →
 * extract → project → resolve → retain → compound. Personal processing
 * STRUCTURALLY omits the graph and wiki stages — a personal run cannot
 * publish shared graph/Wiki state even if a scope check were bypassed
 * (R9/AE7).
 */
export function buildPersonalMemoryWorkflowDefinition(
  processorConfigId: string,
): WorkflowDefinition {
  return {
    version: WORKFLOW_DEFINITION_VERSION,
    steps: [
      stage("preflight", "preflight", processorConfigId),
      planReview(
        "Review the proposed personal memory processing plan. You can narrow sources, focus areas, and the time range — never widen them.",
      ),
      stage("acquire", "acquire", processorConfigId),
      stage("extract", "extract", processorConfigId),
      stage("project", "project", processorConfigId),
      stage("resolve", "resolve", processorConfigId),
      stage("retain", "retain", processorConfigId),
      stage("compound", "compound", processorConfigId),
    ],
  };
}

/**
 * Shared blueprint: the personal pipeline plus targeted graph ingest and
 * affected-Wiki compile stages (U4 wires their real implementations; U3
 * ships scope-guarded stubs that hard-reject `user_*` targets).
 */
export function buildSharedMemoryWorkflowDefinition(
  processorConfigId: string,
): WorkflowDefinition {
  return {
    version: WORKFLOW_DEFINITION_VERSION,
    steps: [
      stage("preflight", "preflight", processorConfigId),
      planReview(
        "Review the proposed shared memory processing plan. You can narrow sources, focus areas, and the time range — never widen them.",
      ),
      stage("acquire", "acquire", processorConfigId),
      stage("extract", "extract", processorConfigId),
      stage("project", "project", processorConfigId),
      stage("resolve", "resolve", processorConfigId),
      stage("retain", "retain", processorConfigId),
      stage("compound", "compound", processorConfigId),
      stage("graph", "graph", processorConfigId),
      stage("wiki", "wiki", processorConfigId),
    ],
  };
}

export interface MemoryBlueprint {
  key: MemoryBlueprintKey;
  version: number;
  build: (processorConfigId: string) => WorkflowDefinition;
}

/** The current blueprint for a processor mode. */
export function memoryBlueprintFor(
  mode: "personal" | "shared",
): MemoryBlueprint {
  return mode === "personal"
    ? {
        key: PERSONAL_MEMORY_BLUEPRINT_KEY,
        version: MEMORY_BLUEPRINT_VERSION,
        build: buildPersonalMemoryWorkflowDefinition,
      }
    : {
        key: SHARED_MEMORY_BLUEPRINT_KEY,
        version: MEMORY_BLUEPRINT_VERSION,
        build: buildSharedMemoryWorkflowDefinition,
      };
}

export function memoryBlueprintSourceMetadata(
  blueprint: MemoryBlueprint,
  processorConfigId: string,
): MemoryBlueprintSourceMetadata {
  return {
    blueprintKey: blueprint.key,
    blueprintVersion: blueprint.version,
    processorConfigId,
  };
}

/**
 * True when a workflow_versions.source_metadata value already carries this
 * blueprint at this version for this processor.
 */
export function matchesMemoryBlueprint(
  sourceMetadata: unknown,
  blueprint: MemoryBlueprint,
  processorConfigId: string,
): boolean {
  if (
    !sourceMetadata ||
    typeof sourceMetadata !== "object" ||
    Array.isArray(sourceMetadata)
  ) {
    return false;
  }
  const meta = sourceMetadata as Record<string, unknown>;
  return (
    meta.blueprintKey === blueprint.key &&
    meta.blueprintVersion === blueprint.version &&
    meta.processorConfigId === processorConfigId
  );
}
