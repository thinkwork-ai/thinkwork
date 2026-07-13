import { describe, expect, it } from "vitest";

import {
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
} from "./memory-blueprint.js";
import {
  validateWorkflowDefinition,
  type ApprovalWorkflowStep,
  type MemoryStageWorkflowStep,
} from "./workflow-definition.js";

const PROCESSOR_ID = "b7b6f9a2-6f19-4a2e-9f37-0f8a5df6a111";

describe("memory blueprints", () => {
  it("both blueprints produce definitions the validator accepts", () => {
    for (const build of [
      buildPersonalMemoryWorkflowDefinition,
      buildSharedMemoryWorkflowDefinition,
    ]) {
      const result = validateWorkflowDefinition(build(PROCESSOR_ID));
      expect(result.ok).toBe(true);
    }
  });

  it("personal blueprint STRUCTURALLY omits graph and wiki stages", () => {
    const definition = buildPersonalMemoryWorkflowDefinition(PROCESSOR_ID);
    const stages = definition.steps
      .filter(
        (step): step is MemoryStageWorkflowStep => step.kind === "memory_stage",
      )
      .map((step) => step.stage);
    expect(stages).toEqual([
      "preflight",
      "acquire",
      "extract",
      "project",
      "resolve",
      "retain",
      "compound",
    ]);
  });

  it("shared blueprint ends with graph then wiki", () => {
    const definition = buildSharedMemoryWorkflowDefinition(PROCESSOR_ID);
    const stages = definition.steps
      .filter(
        (step): step is MemoryStageWorkflowStep => step.kind === "memory_stage",
      )
      .map((step) => step.stage);
    expect(stages.slice(-2)).toEqual(["graph", "wiki"]);
  });

  it("plan review pauses only manual runs and follows preflight", () => {
    for (const build of [
      buildPersonalMemoryWorkflowDefinition,
      buildSharedMemoryWorkflowDefinition,
    ]) {
      const definition = build(PROCESSOR_ID);
      const review = definition.steps[1] as ApprovalWorkflowStep;
      expect(definition.steps[0]).toMatchObject({
        kind: "memory_stage",
        stage: "preflight",
      });
      expect(review.kind).toBe("approval");
      expect(review.when).toEqual({ triggerFamily: ["manual"] });
    }
  });

  it("every memory_stage step binds the processor config id literally", () => {
    const definition = buildSharedMemoryWorkflowDefinition(PROCESSOR_ID);
    for (const step of definition.steps) {
      if (step.kind === "memory_stage") {
        expect(step.processorConfigId).toBe(PROCESSOR_ID);
      }
    }
  });

  it("memoryBlueprintFor selects the mode-correct key", () => {
    expect(memoryBlueprintFor("personal").key).toBe(
      PERSONAL_MEMORY_BLUEPRINT_KEY,
    );
    expect(memoryBlueprintFor("shared").key).toBe(SHARED_MEMORY_BLUEPRINT_KEY);
  });

  it("matchesMemoryBlueprint compares key, version, and processor", () => {
    const blueprint = memoryBlueprintFor("personal");
    const metadata = memoryBlueprintSourceMetadata(blueprint, PROCESSOR_ID);
    expect(matchesMemoryBlueprint(metadata, blueprint, PROCESSOR_ID)).toBe(
      true,
    );
    expect(
      matchesMemoryBlueprint(
        { ...metadata, blueprintVersion: MEMORY_BLUEPRINT_VERSION + 1 },
        blueprint,
        PROCESSOR_ID,
      ),
    ).toBe(false);
    expect(matchesMemoryBlueprint(metadata, blueprint, "other")).toBe(false);
    expect(matchesMemoryBlueprint(null, blueprint, PROCESSOR_ID)).toBe(false);
    expect(matchesMemoryBlueprint({}, blueprint, PROCESSOR_ID)).toBe(false);
  });
});

/**
 * THINK-264 per-stage toggles.
 *
 * The load-bearing property is that the SPINE cannot be switched off. A user
 * who disabled `project` or `retain` would have an automation that still runs
 * and still reports success while writing nothing to memory — the worst
 * failure mode for a memory product, because it is silent. The allowlist is
 * the enforcement point, so these pin it.
 */
describe("memory stage toggles", () => {
  const stagesOf = (definition: { steps: { kind: string }[] }) =>
    definition.steps
      .filter(
        (step): step is MemoryStageWorkflowStep => step.kind === "memory_stage",
      )
      .map((step) => step.stage);

  it("only compound/graph/wiki are toggleable", () => {
    expect([...TOGGLEABLE_MEMORY_STAGES]).toEqual([
      "compound",
      "graph",
      "wiki",
    ]);
    for (const spine of [
      "preflight",
      "acquire",
      "extract",
      "project",
      "resolve",
      "retain",
    ]) {
      expect(isToggleableMemoryStage(spine)).toBe(false);
    }
  });

  it("IGNORES an attempt to disable a spine stage — the pipeline still retains", () => {
    const stages = stagesOf(
      buildSharedMemoryWorkflowDefinition(PROCESSOR_ID, {
        disabledStages: ["acquire", "project", "resolve", "retain"],
      }),
    );
    expect(stages).toContain("acquire");
    expect(stages).toContain("project");
    expect(stages).toContain("resolve");
    expect(stages).toContain("retain");
  });

  it("drops disabled tail stages from the shared definition", () => {
    const stages = stagesOf(
      buildSharedMemoryWorkflowDefinition(PROCESSOR_ID, {
        disabledStages: ["graph", "wiki"],
      }),
    );
    expect(stages).toContain("compound");
    expect(stages).not.toContain("graph");
    expect(stages).not.toContain("wiki");
  });

  it("drops compound from the personal definition when disabled", () => {
    expect(
      stagesOf(
        buildPersonalMemoryWorkflowDefinition(PROCESSOR_ID, {
          disabledStages: ["compound"],
        }),
      ),
    ).toEqual([
      "preflight",
      "acquire",
      "extract",
      "project",
      "resolve",
      "retain",
    ]);
  });

  it("a toggled definition still validates", () => {
    const result = validateWorkflowDefinition(
      buildSharedMemoryWorkflowDefinition(PROCESSOR_ID, {
        disabledStages: ["compound", "graph", "wiki"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("normalizes junk override values to an empty set", () => {
    expect(normalizeDisabledStages(null)).toEqual([]);
    expect(normalizeDisabledStages({})).toEqual([]);
    expect(
      normalizeDisabledStages({ disabledStages: ["retain", "nonsense"] }),
    ).toEqual([]);
  });

  it("a flipped toggle stops matching the stored version, so it supersedes", () => {
    const blueprint = memoryBlueprintFor("personal");
    const stored = memoryBlueprintSourceMetadata(blueprint, PROCESSOR_ID, null);
    expect(matchesMemoryBlueprint(stored, blueprint, PROCESSOR_ID, null)).toBe(
      true,
    );
    expect(
      matchesMemoryBlueprint(stored, blueprint, PROCESSOR_ID, {
        disabledStages: ["compound"],
      }),
    ).toBe(false);
  });

  it("a pre-toggle version (no disabledStages key) still matches an untoggled processor", () => {
    // Otherwise every existing memory workflow would churn a new version on
    // the deploy that ships this change.
    const blueprint = memoryBlueprintFor("personal");
    expect(
      matchesMemoryBlueprint(
        {
          blueprintKey: blueprint.key,
          blueprintVersion: blueprint.version,
          processorConfigId: PROCESSOR_ID,
        },
        blueprint,
        PROCESSOR_ID,
        null,
      ),
    ).toBe(true);
  });
});
