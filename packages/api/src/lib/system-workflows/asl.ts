import type { SystemWorkflowDefinition } from "./types.js";

type AslState = Record<string, unknown>;

export type SystemWorkflowAsl = {
  Comment: string;
  StartAt: string;
  States: Record<string, AslState>;
};

export function buildSystemWorkflowAsl(
  definition: SystemWorkflowDefinition,
): SystemWorkflowAsl {
  if (definition.id === "evaluation-runs") {
    return buildEvaluationRunsAsl(definition);
  }

  const states: Record<string, AslState> = {};
  for (const [index, step] of definition.stepManifest.entries()) {
    const next = definition.stepManifest[index + 1]?.nodeId;
    states[step.nodeId] = {
      Type: "Pass",
      Comment: `${step.runtime}:${step.stepType}:${step.label}`,
      Result: {
        workflowId: definition.id,
        stepType: step.stepType,
        runtime: step.runtime,
      },
      ...(next ? { Next: next } : { End: true }),
    };
  }

  return {
    Comment: `thinkwork-system-workflow:${definition.id}:${definition.activeVersion}`,
    StartAt: definition.stepManifest[0]?.nodeId ?? "Done",
    States: Object.keys(states).length
      ? states
      : {
          Done: {
            Type: "Succeed",
          },
        },
  };
}

function buildEvaluationRunsAsl(
  definition: SystemWorkflowDefinition,
): SystemWorkflowAsl {
  return {
    Comment: `thinkwork-system-workflow:${definition.id}:${definition.activeVersion}`,
    StartAt: "SnapshotTestPack",
    States: {
      SnapshotTestPack: {
        Type: "Pass",
        Comment: "standard:checkpoint:Snapshot test pack",
        Parameters: {
          "runId.$": "$.evalRunId",
          "tenantId.$": "$.tenantId",
          "systemWorkflowRunId.$": "$.workflowRunId",
          "systemWorkflowExecutionArn.$": "$$.Execution.Id",
          "domainRef.$": "$.domainRef",
          "input.$": "$.input",
        },
        Next: "RunEvaluation",
      },
      RunEvaluation: {
        Type: "Task",
        Comment: "standard:worker:Run evaluation via eval-runner",
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: "${eval_runner_lambda_arn}",
          "Payload.$": "$",
        },
        OutputPath: "$.Payload",
        Retry: [
          {
            ErrorEquals: [
              "Lambda.ServiceException",
              "Lambda.AWSLambdaException",
              "Lambda.SdkClientException",
              "Lambda.TooManyRequestsException",
            ],
            IntervalSeconds: 2,
            MaxAttempts: 3,
            BackoffRate: 2,
          },
        ],
        Next: "ApplyPassFailGate",
      },
      ApplyPassFailGate: {
        Type: "Choice",
        Comment: "standard:gate:Apply pass/fail gate",
        Choices: [
          {
            Variable: "$.passedThreshold",
            BooleanEquals: true,
            Next: "EvaluationSucceeded",
          },
        ],
        Default: "EvaluationFailed",
      },
      EvaluationSucceeded: {
        Type: "Succeed",
      },
      EvaluationFailed: {
        Type: "Fail",
        Error: "EvaluationThresholdFailed",
        Cause: "Evaluation pass-rate gate did not pass.",
      },
    },
  };
}
