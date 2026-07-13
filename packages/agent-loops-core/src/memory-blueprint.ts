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
 * The only stages a user may turn off (THINK-264).
 *
 * acquire → project → resolve → retain is the pipeline's spine: each stage
 * feeds the next, so disabling any of them starves everything downstream and
 * silently turns the automation into a no-op (project off ⇒ no claims ⇒ retain
 * writes nothing). Those stay structural. compound/graph/wiki are the optional
 * tail — they refine and publish what is already retained, so switching them
 * off degrades the product without corrupting it.
 *
 * This allowlist is the enforcement point: `stage_overrides.disabledStages` is
 * intent, and anything outside this set is ignored rather than trusted.
 */
export const TOGGLEABLE_MEMORY_STAGES = ["compound", "graph", "wiki"] as const;

export type ToggleableMemoryStage = (typeof TOGGLEABLE_MEMORY_STAGES)[number];

export function isToggleableMemoryStage(
  stage: string,
): stage is ToggleableMemoryStage {
  return (TOGGLEABLE_MEMORY_STAGES as readonly string[]).includes(stage);
}

/** Per-processor stage toggles, as stored on memory_processor_configs. */
export interface MemoryStageOverrides {
  disabledStages?: string[];
}

/**
 * Narrow raw override intent to the stages we actually honor, de-duplicated and
 * ordered so the value is stable enough to compare across blueprint versions.
 */
export function normalizeDisabledStages(
  overrides: MemoryStageOverrides | null | undefined,
): ToggleableMemoryStage[] {
  const raw = overrides?.disabledStages;
  if (!Array.isArray(raw)) return [];
  return TOGGLEABLE_MEMORY_STAGES.filter((stage) => raw.includes(stage));
}

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
  /**
   * Which optional stages were switched off when this version was built. Part
   * of the identity of the version: flipping a toggle changes the step list, so
   * it must supersede the stored version rather than silently diverge from it.
   * In-flight runs stay pinned to the version they captured.
   */
  disabledStages: ToggleableMemoryStage[];
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
  overrides?: MemoryStageOverrides | null,
): WorkflowDefinition {
  const disabled = new Set<string>(normalizeDisabledStages(overrides));
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
      ...(disabled.has("compound")
        ? []
        : [stage("compound", "compound", processorConfigId)]),
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
  overrides?: MemoryStageOverrides | null,
): WorkflowDefinition {
  const disabled = new Set<string>(normalizeDisabledStages(overrides));
  const tail = (["compound", "graph", "wiki"] as const).filter(
    (s) => !disabled.has(s),
  );
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
      ...tail.map((s) => stage(s, s, processorConfigId)),
    ],
  };
}

export interface MemoryBlueprint {
  key: MemoryBlueprintKey;
  version: number;
  build: (
    processorConfigId: string,
    overrides?: MemoryStageOverrides | null,
  ) => WorkflowDefinition;
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
  overrides?: MemoryStageOverrides | null,
): MemoryBlueprintSourceMetadata {
  return {
    blueprintKey: blueprint.key,
    blueprintVersion: blueprint.version,
    processorConfigId,
    disabledStages: normalizeDisabledStages(overrides),
  };
}

/**
 * True when a workflow_versions.source_metadata value already carries this
 * blueprint at this version for this processor AND the same stage toggles.
 * A toggle change makes this false, which is what drives the lazy supersede.
 */
export function matchesMemoryBlueprint(
  sourceMetadata: unknown,
  blueprint: MemoryBlueprint,
  processorConfigId: string,
  overrides?: MemoryStageOverrides | null,
): boolean {
  if (
    !sourceMetadata ||
    typeof sourceMetadata !== "object" ||
    Array.isArray(sourceMetadata)
  ) {
    return false;
  }
  const meta = sourceMetadata as Record<string, unknown>;
  if (
    meta.blueprintKey !== blueprint.key ||
    meta.blueprintVersion !== blueprint.version ||
    meta.processorConfigId !== processorConfigId
  ) {
    return false;
  }
  // Pre-THINK-264 versions have no disabledStages key; treat that as "none
  // disabled" so an untoggled processor doesn't churn a new version on deploy.
  const stored = Array.isArray(meta.disabledStages)
    ? TOGGLEABLE_MEMORY_STAGES.filter((s) =>
        (meta.disabledStages as unknown[]).includes(s),
      )
    : [];
  const wanted = normalizeDisabledStages(overrides);
  return (
    stored.length === wanted.length && stored.every((s, i) => s === wanted[i])
  );
}
