import { describe, expect, it } from "vitest";

import {
  buildPersonalMemoryWorkflowDefinition,
  buildSharedMemoryWorkflowDefinition,
  matchesMemoryBlueprint,
  memoryBlueprintFor,
  memoryBlueprintSourceMetadata,
  MEMORY_BLUEPRINT_VERSION,
  PERSONAL_MEMORY_BLUEPRINT_KEY,
  SHARED_MEMORY_BLUEPRINT_KEY,
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
