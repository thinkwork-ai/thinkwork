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
