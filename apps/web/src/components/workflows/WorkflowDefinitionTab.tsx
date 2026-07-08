import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ExternalLink, X } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkflowRoutineSummaryQuery } from "@/lib/graphql-queries";
import { WorkflowDefinitionCanvas } from "./WorkflowDefinitionCanvas";
import {
  DefinitionList,
  formatDateTime,
  InfoCard,
  JsonPreview,
  titleize,
} from "./workflow-ui";

/**
 * Definition tab body (THINK-218 feedback pass): full-height canvas on the
 * left, a persistent side CARD on the right. The card defaults to workflow
 * information (version snapshot, capabilities, raw definition); clicking a
 * step node focuses the card on that step, with a jump into the routine
 * editor for routine steps. Closing the step focus returns to the workflow
 * information — the card never disappears, so the canvas stays centered in a
 * stable viewport.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RoutineSummary = {
  id: string;
  name: string;
  description?: string | null;
  engine: string;
  status: string;
  modulePath?: string | null;
  validatedSha?: string | null;
};

/**
 * What the routine IS — description, module path in the tenant repo, and the
 * validated commit — with the jump into the routine editor. Replaces the raw
 * step JSON for routine steps.
 */
function RoutineSummaryCard({ routineId }: { routineId: string }) {
  const [result] = useQuery<{ routine?: RoutineSummary | null }>({
    query: WorkflowRoutineSummaryQuery,
    variables: { id: routineId },
  });
  const routine = result.data?.routine ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/70 p-4">
        {result.fetching ? (
          <p className="text-sm text-muted-foreground">Loading routine…</p>
        ) : routine ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {routine.name}
              </span>
              <StatusBadge status={routine.status.toLowerCase()} size="sm" />
            </div>
            {routine.description ? (
              <p className="text-sm text-muted-foreground">
                {routine.description}
              </p>
            ) : null}
            <DefinitionList
              items={[
                ...(routine.modulePath
                  ? [
                      {
                        label: "Module",
                        value: (
                          <span className="break-all font-mono text-xs">
                            {routine.modulePath}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(routine.validatedSha
                  ? [
                      {
                        label: "Validated commit",
                        value: (
                          <span className="font-mono text-xs">
                            {routine.validatedSha.slice(0, 10)}
                          </span>
                        ),
                      },
                    ]
                  : []),
                { label: "Engine", value: titleize(routine.engine) },
              ]}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This routine could not be loaded — it may have been deleted.
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/settings/routines/$routineId" params={{ routineId }}>
            Open routine editor
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function definitionSteps(definition: unknown): Record<string, unknown>[] {
  if (!isRecord(definition) || !Array.isArray(definition.steps)) return [];
  return definition.steps.filter(isRecord);
}

export function WorkflowDefinitionTab({
  definition,
  version,
}: {
  definition: unknown;
  version: {
    versionNumber?: number | null;
    versionStatus?: string | null;
    sourceKind?: string | null;
    publishedAt?: string | null;
  } | null;
}) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const steps = useMemo(() => definitionSteps(definition), [definition]);
  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    return (
      steps.find(
        (step, index) =>
          (typeof step.id === "string" ? step.id : `step-${index + 1}`) ===
          selectedStepId,
      ) ?? null
    );
  }, [steps, selectedStepId]);
  const selectedKind =
    selectedStep && typeof selectedStep.kind === "string"
      ? selectedStep.kind
      : null;
  const selectedRoutineId =
    selectedStep &&
    selectedKind === "routine" &&
    typeof selectedStep.routineId === "string"
      ? selectedStep.routineId
      : null;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="relative min-h-0 min-w-0 flex-1">
        {steps.length > 0 ? (
          <WorkflowDefinitionCanvas
            definition={definition}
            className="h-full min-h-0"
            selectedNodeId={selectedStepId}
            onSelectNode={(nodeId) =>
              setSelectedStepId(
                nodeId && !nodeId.startsWith("__") ? nodeId : null,
              )
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">
              No structured step definition is available for this workflow
              version.
            </p>
          </div>
        )}
      </div>

      {/* Persistent side card: workflow info by default, focused step on
          node click. */}
      <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card xl:w-[400px]">
        {selectedStep ? (
          <>
            <div className="flex items-start gap-2 border-b border-border p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">
                    {selectedStepId}
                  </span>
                  {selectedKind ? (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {titleize(selectedKind)}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Step configuration from the workflow definition.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label="Back to workflow information"
                onClick={() => setSelectedStepId(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {selectedRoutineId ? (
                <RoutineSummaryCard routineId={selectedRoutineId} />
              ) : (
                <InfoCard title="Step definition">
                  <JsonPreview value={selectedStep} />
                </InfoCard>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-border p-4">
              <span className="text-sm font-semibold">Workflow</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select a step on the canvas to inspect it.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <DefinitionList
                items={[
                  { label: "Version", value: version?.versionNumber ?? "—" },
                  {
                    label: "Status",
                    value: titleize(version?.versionStatus),
                  },
                  { label: "Source", value: titleize(version?.sourceKind) },
                  {
                    label: "Published",
                    value: formatDateTime(version?.publishedAt),
                  },
                ]}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
