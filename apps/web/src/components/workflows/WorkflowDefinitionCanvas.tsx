import { useMemo } from "react";
import { RoutineFlowCanvas } from "@/components/routines/RoutineFlowCanvas";
import { buildWorkflowDefinitionGraph } from "./workflowDefinitionGraph";

/**
 * Visual canvas for a workflow's typed-steps definition (THINK-218). Reuses
 * the routine flow canvas renderer with a graph built from the ThinkWork
 * workflow definition instead of Step Functions ASL. Renders nothing when the
 * snapshot doesn't match the typed-steps shape — the DefinitionStepsPanel
 * below it already shows the neutral placeholder.
 */
export function WorkflowDefinitionCanvas({
  definition,
}: {
  definition: unknown;
}) {
  const graph = useMemo(
    () => buildWorkflowDefinitionGraph(definition),
    [definition],
  );
  if (graph.error) return null;
  return (
    <RoutineFlowCanvas
      mode="execution"
      graph={graph}
      aslJson={null}
      emptyLabel="No workflow graph available."
    />
  );
}
