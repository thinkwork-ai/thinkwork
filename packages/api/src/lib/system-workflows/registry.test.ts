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

  it("builds evaluation ASL with a ThinkWork definition marker and pass/fail gate", () => {
    const definition = getSystemWorkflowDefinition("evaluation-runs");
    const asl = buildSystemWorkflowAsl(definition!);

    expect(definition).toBeTruthy();
    expect(asl.Comment).toBe(
      "thinkwork-system-workflow:evaluation-runs:2026-05-02.v1",
    );
    expect(asl.States.RunEvaluation).toMatchObject({
      Type: "Task",
      Resource: "arn:aws:states:::lambda:invoke",
      Parameters: {
        FunctionName: "${eval_runner_lambda_arn}",
        "Payload.$": "$",
      },
    });
    expect(asl.States.ApplyPassFailGate).toMatchObject({
      Type: "Choice",
      Default: "EvaluationFailed",
    });
    expect(asl.States.EvaluationFailed).toMatchObject({
      Type: "Fail",
      Error: "EvaluationThresholdFailed",
    });
  });

  it("builds wiki-build ASL with a Lambda task and failure gate", () => {
    const definition = getSystemWorkflowDefinition("wiki-build");
    const asl = buildSystemWorkflowAsl(definition!);

    expect(definition).toBeTruthy();
    expect(asl.Comment).toBe(
      "thinkwork-system-workflow:wiki-build:2026-05-02.v1",
    );
    expect(asl.States.CompilePages).toMatchObject({
      Type: "Task",
      Resource: "arn:aws:states:::lambda:invoke",
      Parameters: {
        FunctionName: "${wiki_compile_lambda_arn}",
        "Payload.$": "$",
      },
    });
    expect(asl.States.ValidateGraph).toMatchObject({
      Type: "Choice",
      Default: "WikiBuildFailed",
    });
    expect(asl.States.WikiBuildFailed).toMatchObject({
      Type: "Fail",
      Error: "WikiBuildFailed",
    });
  });

  it("builds tenant-agent-activation ASL with a Lambda task and failure gate", () => {
    const definition = getSystemWorkflowDefinition("tenant-agent-activation");
    const asl = buildSystemWorkflowAsl(definition!);

    expect(definition).toBeTruthy();
    expect(asl.Comment).toBe(
      "thinkwork-system-workflow:tenant-agent-activation:2026-05-02.v1",
    );
    expect(asl.States.ApplyActivationBundle).toMatchObject({
      Type: "Task",
      Resource: "arn:aws:states:::lambda:invoke",
      Parameters: {
        FunctionName: "${activation_workflow_adapter_lambda_arn}",
        "Payload.$": "$",
      },
    });
    expect(asl.States.RecordLaunchDecision).toMatchObject({
      Type: "Choice",
      Default: "ActivationWorkflowFailed",
    });
    expect(asl.States.ActivationWorkflowFailed).toMatchObject({
      Type: "Fail",
      Error: "ActivationWorkflowFailed",
    });
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
