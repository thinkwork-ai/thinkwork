import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RoutineFlowCanvas } from "./RoutineFlowCanvas";
import { RoutineFlowInspector } from "./RoutineFlowInspector";
import { RoutineAddStepCommand } from "./RoutineAddStepCommand";
import type {
  RoutineConfigField,
  RoutineConfigStep,
} from "./RoutineStepConfigEditor";

export type RoutineRecipeCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  category: string;
  hitlCapable: boolean;
  defaultArgs: unknown;
  configFields: RoutineConfigField[];
};

interface RoutineWorkflowEditorProps {
  steps: RoutineConfigStep[];
  recipes: RoutineRecipeCatalogItem[];
  fieldValues: Record<string, string>;
  aslJson?: unknown;
  stepManifestJson?: unknown;
  topologyDirty?: boolean;
  onFieldChange: (key: string, value: string) => void;
  onAddRecipe: (
    recipe: RoutineRecipeCatalogItem,
    afterNodeId?: string | null,
  ) => void;
  onLabelChange: (nodeId: string, value: string) => void;
  onMoveStep: (nodeId: string, direction: "up" | "down") => void;
  onRemoveStep: (nodeId: string) => void;
  catalogLoading?: boolean;
  fieldErrors?: Record<string, string>;
}

export function RoutineWorkflowEditor({
  steps,
  recipes,
  fieldValues,
  aslJson,
  stepManifestJson,
  topologyDirty = false,
  onFieldChange,
  onAddRecipe,
  onLabelChange,
  onRemoveStep,
  catalogLoading = false,
  fieldErrors = {},
}: RoutineWorkflowEditorProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => steps[0]?.nodeId ?? null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addAfterNodeId, setAddAfterNodeId] = useState<string | null>(null);
  const issueCount = Object.keys(fieldErrors).length;
  const configurableFieldCount = steps.reduce(
    (count, step) => count + step.configFields.length,
    0,
  );
  const configuredFieldCount = steps.reduce(
    (count, step) =>
      count +
      step.configFields.filter((field) =>
        (fieldValues[fieldKey(step.nodeId, field.key)] ?? "").trim(),
      ).length,
    0,
  );
  const localManifest = useMemo(() => manifestFromSteps(steps), [steps]);
  const graphAsl = useMemo(
    () => (topologyDirty || !aslJson ? linearAslFromSteps(steps) : aslJson),
    [aslJson, steps, topologyDirty],
  );
  const graphManifest = topologyDirty
    ? localManifest
    : (stepManifestJson ?? localManifest);

  useEffect(() => {
    if (steps.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (!steps.some((step) => step.nodeId === selectedNodeId)) {
      setSelectedNodeId(steps[0]?.nodeId ?? null);
    }
  }, [selectedNodeId, steps]);

  const openAddStep = (afterNodeId: string | null) => {
    setAddAfterNodeId(afterNodeId);
    setAddOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Workflow</h2>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <Badge variant="secondary">
              {steps.length} {steps.length === 1 ? "step" : "steps"}
            </Badge>
            {configurableFieldCount > 0 && (
              <Badge variant="outline">
                {configuredFieldCount}/{configurableFieldCount} configured
              </Badge>
            )}
            {issueCount > 0 ? (
              <Badge className="border-transparent bg-destructive/10 text-destructive">
                <AlertCircle className="h-3 w-3" />
                {issueCount} {issueCount === 1 ? "issue" : "issues"}
              </Badge>
            ) : steps.length > 0 ? (
              <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                No issues
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <RoutineFlowCanvas
          mode="authoring"
          aslJson={graphAsl}
          stepManifestJson={graphManifest}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onAddStepAfter={openAddStep}
          emptyLabel={
            catalogLoading
              ? "Loading routine recipes..."
              : "No workflow steps yet"
          }
        />
        <RoutineFlowInspector
          mode="authoring"
          selectedNodeId={selectedNodeId}
          steps={steps}
          fieldValues={fieldValues}
          fieldErrors={fieldErrors}
          onFieldChange={onFieldChange}
          onLabelChange={onLabelChange}
          onRemoveStep={onRemoveStep}
        />
      </div>

      <RoutineAddStepCommand
        open={addOpen}
        recipes={recipes}
        onOpenChange={setAddOpen}
        onSelectRecipe={(recipe) => {
          onAddRecipe(recipe, addAfterNodeId);
          setSelectedNodeId(null);
        }}
      />
    </div>
  );
}

function linearAslFromSteps(
  steps: RoutineConfigStep[],
): Record<string, unknown> {
  const states = Object.fromEntries(
    steps.map((step, index) => {
      const next = steps[index + 1]?.nodeId;
      return [
        step.nodeId,
        {
          Type: "Task",
          Comment: `recipe:${step.recipeId}`,
          ...(next ? { Next: next } : { End: true }),
        },
      ];
    }),
  );
  return {
    StartAt: steps[0]?.nodeId,
    States: states,
  };
}

function manifestFromSteps(
  steps: RoutineConfigStep[],
): Record<string, unknown> {
  return {
    definition: {
      kind: "recipe_graph",
      steps: steps.map((step) => ({
        nodeId: step.nodeId,
        recipeId: step.recipeId,
        label: step.label,
        args: step.args,
      })),
    },
    steps: steps.map((step) => ({
      nodeId: step.nodeId,
      recipeType: step.recipeId,
      label: step.label,
      args: step.args,
    })),
  };
}

function fieldKey(nodeId: string, key: string): string {
  return `${nodeId}.${key}`;
}
