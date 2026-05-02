import { useCallback, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  CreateRoutineMutation,
  PlanRoutineDraftMutation,
  RoutineRecipeCatalogQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RoutineWorkflowEditor,
  type RoutineRecipeCatalogItem,
} from "@/components/routines/RoutineWorkflowEditor";
import {
  argsFromStepFields,
  valuesFromSteps,
  type RoutineConfigStep,
} from "@/components/routines/RoutineStepConfigEditor";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/routines/new",
)({
  component: NewRoutinePage,
});

function NewRoutinePage() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, executeCreate] = useMutation(CreateRoutineMutation);
  const [planState, executePlan] = useMutation(PlanRoutineDraftMutation);
  const [catalogResult] = useQuery({
    query: RoutineRecipeCatalogQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  useBreadcrumbs([
    { label: "Routines", href: "/automations/routines" },
    { label: "New" },
  ]);

  const recipes = useMemo(
    () => catalogResult.data?.routineRecipeCatalog ?? [],
    [catalogResult.data?.routineRecipeCatalog],
  );
  const steps = draft?.steps ?? [];
  const canPlan =
    name.trim().length > 0 && description.trim().length > 0 && !submitting;
  const canPublish = name.trim().length > 0 && steps.length > 0 && !submitting;

  const replaceSteps = useCallback(
    (nextSteps: RoutineConfigStep[]) => {
      setDraft((current) => ({
        title: current?.title ?? (name.trim() || "Untitled routine"),
        description: current?.description ?? description.trim(),
        kind: current?.kind ?? "recipe_graph",
        steps: nextSteps,
        asl: current?.asl ?? null,
        markdownSummary: current?.markdownSummary ?? "",
        stepManifest: current?.stepManifest ?? null,
      }));
      setFieldValues((current) => mergeFieldValues(nextSteps, current));
    },
    [description, name],
  );

  const handlePlan = useCallback(async () => {
    if (!canPlan || !tenantId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await executePlan({
        input: {
          tenantId,
          name: name.trim(),
          description: description.trim(),
        },
      });
      if (result.error) throw new Error(result.error.message);
      const nextDraft = result.data?.planRoutineDraft;
      if (!nextDraft) throw new Error("Planner returned no routine draft.");
      setDraft(nextDraft);
      setFieldValues(valuesFromSteps(nextDraft.steps));
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setSubmitting(false);
    }
  }, [canPlan, tenantId, name, description, executePlan]);

  const handlePublish = useCallback(async () => {
    if (!canPublish || !tenantId) return;
    setSubmitting(true);
    setError(null);
    try {
      const planned = await executePlan({
        input: {
          tenantId,
          name: name.trim(),
          description: description.trim(),
          steps: steps.map((step) => ({
            nodeId: step.nodeId,
            recipeId: step.recipeId,
            label: step.label,
            args: fullArgsFromStep(step, fieldValues),
          })),
        },
      });
      if (planned.error) throw new Error(planned.error.message);
      const reviewedDraft = planned.data?.planRoutineDraft;
      if (!reviewedDraft) throw new Error("Planner returned no routine draft.");
      setDraft(reviewedDraft);
      setFieldValues(valuesFromSteps(reviewedDraft.steps));

      const result = await executeCreate({
        input: {
          tenantId,
          name: name.trim(),
          description: reviewedDraft.description ?? description.trim(),
          asl: reviewedDraft.asl,
          markdownSummary: reviewedDraft.markdownSummary,
          stepManifest: reviewedDraft.stepManifest,
        },
      });
      if (result.error) throw new Error(result.error.message);
      const routineId = result.data?.createRoutine?.id;
      if (!routineId) {
        throw new Error("Failed to create routine (no id returned).");
      }
      navigate({
        to: "/automations/routines/$routineId",
        params: { routineId },
      });
    } catch (err) {
      setError(cleanError(err));
      setSubmitting(false);
    }
  }, [
    canPublish,
    tenantId,
    name,
    description,
    steps,
    fieldValues,
    executePlan,
    executeCreate,
    navigate,
  ]);

  const handleAddRecipe = useCallback(
    (recipe: RoutineRecipeCatalogItem) => {
      const nextStep = stepFromRecipe(recipe, steps);
      replaceSteps([...steps, nextStep]);
    },
    [replaceSteps, steps],
  );

  const handleLabelChange = useCallback(
    (nodeId: string, value: string) => {
      replaceSteps(
        steps.map((step) =>
          step.nodeId === nodeId ? { ...step, label: value } : step,
        ),
      );
    },
    [replaceSteps, steps],
  );

  const handleMoveStep = useCallback(
    (nodeId: string, direction: "up" | "down") => {
      const index = steps.findIndex((step) => step.nodeId === nodeId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= steps.length) return;
      const nextSteps = [...steps];
      const [step] = nextSteps.splice(index, 1);
      if (!step) return;
      nextSteps.splice(target, 0, step);
      replaceSteps(nextSteps);
    },
    [replaceSteps, steps],
  );

  const handleRemoveStep = useCallback(
    (nodeId: string) => {
      replaceSteps(steps.filter((step) => step.nodeId !== nodeId));
    },
    [replaceSteps, steps],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: "/automations/routines" })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title="New routine"
          description="Plan from a prompt, edit the workflow, then publish it."
        />
      </div>

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Triage overnight email"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Planner prompt</label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="e.g. Pull overnight email from the inbox, classify each into urgent/normal, post a digest to #ops, and require approval before sending replies."
                rows={3}
                className="min-h-24 resize-y"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {draft && <Badge variant="outline">{draft.kind}</Badge>}
              {draft?.description && (
                <span className="max-w-2xl truncate text-sm text-muted-foreground">
                  {draft.description}
                </span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/automations/routines" })}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handlePlan} disabled={!canPlan}>
                <Sparkles className="h-4 w-4" />
                {submitting && planState.fetching
                  ? "Planning..."
                  : "Plan routine"}
              </Button>
              <Button onClick={handlePublish} disabled={!canPublish}>
                {submitting && !planState.fetching
                  ? "Publishing..."
                  : "Publish workflow"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <RoutineWorkflowEditor
        steps={steps}
        recipes={recipes}
        fieldValues={fieldValues}
        onFieldChange={(key, value) =>
          setFieldValues((current) => ({ ...current, [key]: value }))
        }
        onAddRecipe={handleAddRecipe}
        onLabelChange={handleLabelChange}
        onMoveStep={handleMoveStep}
        onRemoveStep={handleRemoveStep}
        catalogLoading={catalogResult.fetching}
      />
    </div>
  );
}

type RoutineDraft = {
  title: string;
  description?: string | null;
  kind: string;
  steps: RoutineConfigStep[];
  asl: unknown;
  markdownSummary: string;
  stepManifest: unknown;
};

function cleanError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^\[GraphQL\]\s*/, "");
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

function fullArgsFromStep(
  step: RoutineConfigStep,
  fieldValues: Record<string, string>,
): Record<string, unknown> {
  return {
    ...jsonObject(step.args),
    ...argsFromStepFields(step, fieldValues),
  };
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

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
