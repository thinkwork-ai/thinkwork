import { describe, expect, it } from "vitest";
import {
  RunbookValidationError,
  validateRunbookDefinition,
} from "../schema.js";

function validDefinition() {
  return {
    slug: "sample-runbook",
    version: "0.1.0",
    catalog: {
      displayName: "Sample Runbook",
      description: "A sample runbook for schema tests.",
      category: "dashboard",
    },
    routing: {
      explicitAliases: ["sample runbook"],
      triggerExamples: ["Run the sample runbook."],
      confidenceHints: ["The prompt names sample work."],
    },
    inputs: [
      {
        id: "topic",
        label: "Topic",
        required: false,
        source: "user",
      },
    ],
    approval: {
      title: "Run Sample",
      summary: "Computer will run the sample.",
      expectedOutputs: ["Sample artifact"],
      likelyTools: ["workspace search"],
      phaseSummary: ["Discover.", "Produce."],
    },
    phases: [
      {
        id: "discover",
        title: "Discover",
        guidance: "discover.md",
        capabilityRoles: ["research"],
        dependsOn: [],
        taskSeeds: ["Find inputs."],
      },
      {
        id: "produce",
        title: "Produce",
        guidance: "produce.md",
        capabilityRoles: ["artifact_build"],
        dependsOn: ["discover"],
        taskSeeds: ["Create output."],
      },
    ],
    outputs: [
      {
        id: "artifact",
        title: "Artifact",
        type: "artifact",
        description: "A generated artifact.",
      },
    ],
    overrides: {
      allowedFields: ["catalog.description", "approval.summary"],
    },
  };
}

describe("validateRunbookDefinition", () => {
  it("normalizes a valid runbook definition", () => {
    const runbook = validateRunbookDefinition(validDefinition());

    expect(runbook).toMatchObject({
      slug: "sample-runbook",
      version: "0.1.0",
      catalog: { displayName: "Sample Runbook" },
    });
    expect(runbook.phases).toHaveLength(2);
    expect(runbook.phases[1]?.dependsOn).toEqual(["discover"]);
  });

  it("allows explicitly experimental capability roles", () => {
    const definition = validDefinition();
    definition.phases[0]!.capabilityRoles = ["experimental:forecasting"];

    expect(
      validateRunbookDefinition(definition).phases[0]?.capabilityRoles,
    ).toEqual(["experimental:forecasting"]);
  });

  it("rejects unknown capability roles", () => {
    const definition = validDefinition();
    definition.phases[0]!.capabilityRoles = ["forecasting"];

    expect(() => validateRunbookDefinition(definition)).toThrow(
      RunbookValidationError,
    );
    try {
      validateRunbookDefinition(definition);
    } catch (err) {
      expect((err as RunbookValidationError).issues).toContain(
        'phases[0].capabilityRoles contains unknown role "forecasting"',
      );
    }
  });

  it("rejects dependencies that do not reference declared phases", () => {
    const definition = validDefinition();
    definition.phases[1]!.dependsOn = ["missing"];

    expect(() => validateRunbookDefinition(definition)).toThrow(
      RunbookValidationError,
    );
  });

  it("rejects unsupported operator override fields", () => {
    const definition = validDefinition();
    definition.overrides.allowedFields = ["phases"] as string[];

    expect(() => validateRunbookDefinition(definition)).toThrow(
      RunbookValidationError,
    );
    try {
      validateRunbookDefinition(definition);
    } catch (err) {
      expect((err as RunbookValidationError).issues).toContain(
        'overrides.allowedFields contains unsupported field "phases"',
      );
    }
  });
});
