/**
 * Admin "new routine" surface (Plan 2026-05-01-007 §U13).
 *
 * v1 ships as a thin form: operator enters name + description, and the
 * server-side authoring MVP attempts to produce real recipe-backed ASL
 * through `createRoutine`. Unsupported intents are rejected before any
 * Step Functions resources are created.
 *
 * Plan §"Files" calls for a full RoutineChatBuilder admin chrome
 * (sharing the mobile ROUTINE_BUILDER_PROMPT). Mobile's chat session
 * infrastructure (createSession / sendToSession) is currently stubbed
 * pending GraphQL migration (per Phase C U10's caveat); this form is the
 * non-chat authoring bridge until that lands.
 */

import { useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  CreateRoutineMutation,
  PlanRoutineDraftMutation,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RoutineStepConfigEditor,
  argsFromStepFields,
  changedSteps,
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

  useBreadcrumbs([
    { label: "Routines", href: "/automations/routines" },
    { label: "New" },
  ]);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  const handlePlan = useCallback(async () => {
    if (!canSubmit || !tenantId || submitting) return;
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
  }, [
    canSubmit,
    tenantId,
    submitting,
    name,
    description,
    executePlan,
  ]);

  const handlePublish = useCallback(async () => {
    if (!draft || !tenantId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let reviewedDraft = draft;
      const dirtySteps = changedSteps(draft.steps, fieldValues);
      if (dirtySteps.length > 0) {
        const planned = await executePlan({
          input: {
            tenantId,
            name: name.trim(),
            description: description.trim(),
            steps: dirtySteps.map((step) => ({
              nodeId: step.nodeId,
              args: argsFromStepFields(step, fieldValues),
            })),
          },
        });
        if (planned.error) throw new Error(planned.error.message);
        const nextDraft = planned.data?.planRoutineDraft;
        if (!nextDraft) throw new Error("Planner returned no routine draft.");
        reviewedDraft = nextDraft;
        setDraft(nextDraft);
        setFieldValues(valuesFromSteps(nextDraft.steps));
      }

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
    draft,
    tenantId,
    submitting,
    name,
    description,
    fieldValues,
    executePlan,
    executeCreate,
    navigate,
  ]);

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
          description="Describe the routine, review the generated recipe steps, then publish it."
        />
      </div>

      <Card className="max-w-2xl">
        <CardContent className="space-y-4 py-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDraft(null);
              }}
              placeholder="e.g. Triage overnight email"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">What should it do?</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDraft(null);
              }}
              placeholder="e.g. Pull overnight email from the inbox, classify each into urgent/normal, post a digest to #ops, and require approval before sending replies."
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/automations/routines" })}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handlePlan} disabled={!canSubmit || submitting}>
              <Sparkles className="h-4 w-4" />
              {submitting && planState.fetching ? "Planning..." : "Plan routine"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardContent className="space-y-4 p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Draft definition</h2>
                  <Badge variant="outline">{draft.kind}</Badge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {draft.description}
                </p>
              </div>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={submitting}
              >
                {submitting ? "Publishing..." : "Publish routine"}
              </Button>
            </div>
            <RoutineStepConfigEditor
              steps={draft.steps}
              fieldValues={fieldValues}
              onFieldChange={(key, value) =>
                setFieldValues((current) => ({ ...current, [key]: value }))
              }
            />
          </CardContent>
        </Card>
      )}
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
