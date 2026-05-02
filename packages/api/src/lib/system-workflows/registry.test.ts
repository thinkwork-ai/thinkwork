import { describe, expect, it } from "vitest";
import {
  defaultSystemWorkflowConfig,
  getSystemWorkflowDefinition,
  listSystemWorkflowDefinitions,
} from "./registry.js";
import { buildSystemWorkflowAsl } from "./asl.js";
import { validateSystemWorkflowConfig } from "./validation.js";

describe("system workflow registry", () => {
  it("defines the three v1 system workflows with stable ids", () => {
    expect(
      listSystemWorkflowDefinitions().map((definition) => definition.id),
    ).toEqual(["wiki-build", "evaluation-runs", "tenant-agent-activation"]);
  });

  it("builds ASL with a ThinkWork definition marker", () => {
    const definition = getSystemWorkflowDefinition("evaluation-runs");

    expect(definition).toBeTruthy();
    expect(buildSystemWorkflowAsl(definition!).Comment).toBe(
      "thinkwork-system-workflow:evaluation-runs:2026-05-02.v1",
    );
  });

  it("validates config against required typed fields", () => {
    const definition = getSystemWorkflowDefinition("tenant-agent-activation")!;
    const config = defaultSystemWorkflowConfig(definition);

    expect(validateSystemWorkflowConfig(definition.id, config)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      validateSystemWorkflowConfig(definition.id, {
        ...config,
        launchApprovalRole: "member",
      }),
    ).toEqual({
      valid: false,
      errors: [{ field: "launchApprovalRole", message: "Unsupported option" }],
    });
  });
});
