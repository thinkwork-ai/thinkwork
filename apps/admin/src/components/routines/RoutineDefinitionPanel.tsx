import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/context/TenantContext";
import {
  RoutineRecipeCatalogQuery,
  RoutineDefinitionArtifactsQuery,
  RoutineDefinitionQuery,
  UpdateRoutineDefinitionMutation,
} from "@/lib/graphql-queries";
import {
  argsFromStepFields,
  hasValidationErrors,
  validationErrorsFromSteps,
  valuesFromSteps,
  type RoutineConfigStep,
} from "./RoutineStepConfigEditor";
import {
  RoutineWorkflowEditor,
  type RoutineRecipeCatalogItem,
} from "./RoutineWorkflowEditor";

interface RoutineDefinitionPanelProps {
  routineId: string;
  onPublished?: () => void;
  onStateChange?: (state: RoutineDefinitionEditorState) => void;
  layout?: "default" | "workspace";
}

export interface RoutineDefinitionEditorState {
  ready: boolean;
  dirty: boolean;
  invalid: boolean;
  saving: boolean;
  currentVersion: number | null;
}

export function RoutineDefinitionPanel({
  routineId,
  onPublished,
  onStateChange,
  layout = "default",
}: RoutineDefinitionPanelProps) {
  const { tenantId } = useTenant();
  const [queryResult, refetch] = useQuery({
    query: RoutineDefinitionQuery,
    variables: { routineId },
    requestPolicy: "cache-and-network",
  });
  const [artifactResult, refetchArtifacts] = useQuery({
    query: RoutineDefinitionArtifactsQuery,
    variables: { routineId },
    requestPolicy: "cache-and-network",
  });
  const [catalogResult] = useQuery({
    query: RoutineRecipeCatalogQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [updateState, executeUpdate] = useMutation(
    UpdateRoutineDefinitionMutation,
  );
  const definition = queryResult.data?.routineDefinition;
  const queryErrorMessage = queryResult.error?.message.replace(
    /^\[GraphQL\]\s*/,
    "",
  );
  const definitionQueryUnsupported =
    !!queryErrorMessage &&
    (queryErrorMessage.includes('Cannot query field "routineDefinition"') ||
      queryErrorMessage.includes('Cannot query field "configFields"') ||
      queryErrorMessage.includes('Cannot query field "recipeName"'));
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<RoutineConfigStep[]>([]);

  useEffect(() => {
    if (!definition) return;
    setSteps(definition.steps);
    setFieldValues(valuesFromSteps(definition.steps));
  }, [definition?.versionId]);

  const originalSnapshot = useMemo(() => {
    if (!definition) return [];
    return stepsForMutation(
      definition.steps,
      valuesFromSteps(definition.steps),
    );
  }, [definition]);

  const editedSnapshot = useMemo(
    () => stepsForMutation(steps, fieldValues),
    [fieldValues, steps],
  );
  const validationErrors = useMemo(
    () => validationErrorsFromSteps(steps, fieldValues),
    [fieldValues, steps],
  );
  const issueCount = Object.keys(validationErrors).length;
  const invalid = hasValidationErrors(validationErrors);
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

  const dirty =
    JSON.stringify(originalSnapshot) !== JSON.stringify(editedSnapshot);
  const topologyDirty = useMemo(() => {
    const originalIds = definition?.steps.map((step) => step.nodeId) ?? [];
    const editedIds = steps.map((step) => step.nodeId);
    return JSON.stringify(originalIds) !== JSON.stringify(editedIds);
  }, [definition?.steps, steps]);

  useEffect(() => {
    onStateChange?.({
      ready:
        !!definition ||
        definitionQueryUnsupported ||
        (!queryResult.fetching && !queryResult.error),
      dirty,
      invalid,
      saving: updateState.fetching,
      currentVersion: definition?.currentVersion ?? null,
    });
  }, [
    definition,
    definitionQueryUnsupported,
    dirty,
    invalid,
    onStateChange,
    queryResult.error,
    queryResult.fetching,
    updateState.fetching,
  ]);

  const save = async () => {
    if (!definition || !dirty) return;
    if (invalid) {
      toast.error("Fix routine configuration errors before saving.");
      return;
    }
    const res = await executeUpdate({
      input: {
        routineId,
        steps: editedSnapshot,
      },
    });

    if (res.error) {
      toast.error(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
      return;
    }

    const version = res.data?.updateRoutineDefinition.currentVersion;
    toast.success(version ? `Published version ${version}.` : "Published.");
    refetch({ requestPolicy: "network-only" });
    refetchArtifacts({ requestPolicy: "network-only" });
    onPublished?.();
  };

  if (queryResult.fetching && !definition) {
    return (
      <section className="mb-5 rounded-lg border border-border/70 bg-card/40 p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-20 animate-pulse rounded bg-muted/70" />
      </section>
    );
  }

  if (queryResult.error) {
    const message = queryErrorMessage ?? "Unable to load routine definition.";
    if (definitionQueryUnsupported) {
      return null;
    }
    return (
      <section className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {message}
      </section>
    );
  }

  if (!definition) return null;

  const recipes = catalogResult.data?.routineRecipeCatalog ?? [];
  const artifactDefinition = artifactResult.data?.routineDefinition;
  const workspace = layout === "workspace";
  const saveButton = (
    <Button
      size="sm"
      onClick={save}
      disabled={!dirty || invalid || updateState.fetching}
      title={
        invalid
          ? "Fix configuration issues before saving"
          : !dirty
            ? "No workflow changes to save"
            : undefined
      }
    >
      <Save className="h-3.5 w-3.5" />
      {updateState.fetching ? "Saving..." : "Save"}
    </Button>
  );

  if (workspace) {
    return (
      <section className="h-full min-h-0">
        <RoutineWorkflowEditor
          steps={steps}
          recipes={recipes}
          fieldValues={fieldValues}
          aslJson={artifactDefinition?.aslJson}
          stepManifestJson={artifactDefinition?.stepManifestJson}
          topologyDirty={topologyDirty}
          layout="workspace"
          sidebarHeader={
            <div className="rounded-md border border-border/70 bg-card/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      Definition
                    </span>
                    {definition.currentVersion && (
                      <Badge variant="outline">
                        v{definition.currentVersion}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                    {dirty ? (
                      <Badge variant="secondary">Unsaved changes</Badge>
                    ) : (
                      <Badge variant="outline">Saved workflow</Badge>
                    )}
                    {configurableFieldCount > 0 && (
                      <Badge variant="outline">
                        {configuredFieldCount}/{configurableFieldCount}{" "}
                        configured
                      </Badge>
                    )}
                    {issueCount > 0 ? (
                      <Badge className="border-transparent bg-destructive/10 text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {issueCount} {issueCount === 1 ? "issue" : "issues"}
                      </Badge>
                    ) : (
                      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        No issues
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="shrink-0">{saveButton}</div>
              </div>
            </div>
          }
          onFieldChange={(key, value) =>
            setFieldValues((current) => ({ ...current, [key]: value }))
          }
          onAddRecipe={(recipe, afterNodeId) => {
            let insertedNodeId: string | null = null;
            setSteps((current) => {
              const step = stepFromRecipe(recipe, current);
              insertedNodeId = step.nodeId;
              const index = current.findIndex(
                (candidate) => candidate.nodeId === afterNodeId,
              );
              const next =
                index < 0
                  ? [...current, step]
                  : [
                      ...current.slice(0, index + 1),
                      step,
                      ...current.slice(index + 1),
                    ];
              setFieldValues((values) => mergeFieldValues(next, values));
              return next;
            });
            return insertedNodeId;
          }}
          onLabelChange={(nodeId, value) =>
            setSteps((current) =>
              current.map((step) =>
                step.nodeId === nodeId ? { ...step, label: value } : step,
              ),
            )
          }
          onMoveStep={(nodeId, direction) =>
            setSteps((current) => moveStep(current, nodeId, direction))
          }
          onRemoveStep={(nodeId) =>
            setSteps((current) =>
              current.filter((step) => step.nodeId !== nodeId),
            )
          }
          fieldErrors={validationErrors}
          catalogLoading={catalogResult.fetching}
        />
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-lg border border-border/70 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Definition</h2>
            {definition.currentVersion && (
              <Badge variant="outline">v{definition.currentVersion}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {definition.description}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            {dirty ? (
              <Badge variant="secondary">Unsaved changes</Badge>
            ) : (
              <Badge variant="outline">Saved workflow</Badge>
            )}
            {issueCount > 0 && (
              <Badge className="border-transparent bg-destructive/10 text-destructive">
                {issueCount} {issueCount === 1 ? "issue" : "issues"}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {dirty
                ? "Save before testing this version."
                : "Test Routine runs this saved version."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">{saveButton}</div>
      </div>

      <div className="p-4">
        <RoutineWorkflowEditor
          steps={steps}
          recipes={recipes}
          fieldValues={fieldValues}
          aslJson={artifactDefinition?.aslJson}
          stepManifestJson={artifactDefinition?.stepManifestJson}
          topologyDirty={topologyDirty}
          onFieldChange={(key, value) =>
            setFieldValues((current) => ({ ...current, [key]: value }))
          }
          onAddRecipe={(recipe, afterNodeId) => {
            let insertedNodeId: string | null = null;
            setSteps((current) => {
              const step = stepFromRecipe(recipe, current);
              insertedNodeId = step.nodeId;
              const index = current.findIndex(
                (candidate) => candidate.nodeId === afterNodeId,
              );
              const next =
                index < 0
                  ? [...current, step]
                  : [
                      ...current.slice(0, index + 1),
                      step,
                      ...current.slice(index + 1),
                    ];
              setFieldValues((values) => mergeFieldValues(next, values));
              return next;
            });
            return insertedNodeId;
          }}
          onLabelChange={(nodeId, value) =>
            setSteps((current) =>
              current.map((step) =>
                step.nodeId === nodeId ? { ...step, label: value } : step,
              ),
            )
          }
          onMoveStep={(nodeId, direction) =>
            setSteps((current) => moveStep(current, nodeId, direction))
          }
          onRemoveStep={(nodeId) =>
            setSteps((current) =>
              current.filter((step) => step.nodeId !== nodeId),
            )
          }
          fieldErrors={validationErrors}
          catalogLoading={catalogResult.fetching}
        />
      </div>
    </section>
  );
}

function stepsForMutation(
  steps: RoutineConfigStep[],
  fieldValues: Record<string, string>,
): Array<{
  nodeId: string;
  recipeId: string;
  label: string;
  args: Record<string, unknown>;
}> {
  return steps.map((step) => ({
    nodeId: step.nodeId,
    recipeId: step.recipeId,
    label: step.label,
    args: {
      ...jsonObject(step.args),
      ...argsFromStepFields(step, fieldValues),
    },
  }));
}

function mergeFieldValues(
  steps: RoutineConfigStep[],
  current: Record<string, string>,
): Record<string, string> {
  const defaults = valuesFromSteps(steps);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      current[key] ?? value,
    ]),
  );
}

function stepFromRecipe(
  recipe: RoutineRecipeCatalogItem,
  existingSteps: RoutineConfigStep[],
): RoutineConfigStep {
  const nodeId = uniqueNodeId(recipe.displayName, existingSteps);
  return {
    nodeId,
    recipeId: recipe.id,
    recipeName: recipe.displayName,
    label: recipe.displayName,
    args: jsonObject(recipe.defaultArgs),
    configFields: recipe.configFields,
  };
}

function moveStep(
  steps: RoutineConfigStep[],
  nodeId: string,
  direction: "up" | "down",
): RoutineConfigStep[] {
  const index = steps.findIndex((step) => step.nodeId === nodeId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const [step] = next.splice(index, 1);
  if (!step) return steps;
  next.splice(target, 0, step);
  return next;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fieldKey(nodeId: string, fieldKeyValue: string): string {
  return `${nodeId}.${fieldKeyValue}`;
}

function uniqueNodeId(
  displayName: string,
  existingSteps: RoutineConfigStep[],
): string {
  const base =
    displayName
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "Step";
  const used = new Set(existingSteps.map((step) => step.nodeId));
  let index = existingSteps.length + 1;
  let candidate = `${base}${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}${index}`;
  }
  return candidate;
}
