import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { PanelRight } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { RoutineFlowCanvas } from "@/components/routines/RoutineFlowCanvas";
import { RoutineFlowInspector } from "@/components/routines/RoutineFlowInspector";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SystemWorkflowDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { RoutineConfigStep } from "@/components/routines/RoutineStepConfigEditor";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/system-workflows/$workflowId",
)({
  component: SystemWorkflowDetailPage,
});

type RunRow = {
  id: string;
  status: string;
  triggerSource: string;
  domainRef: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  errorCode: string | null;
};

type JsonListItem = Record<string, any>;

function asList(value: unknown): JsonListItem[] {
  if (Array.isArray(value)) return value as JsonListItem[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildSystemWorkflowAsl(stepManifestJson: unknown) {
  const steps = asList(stepManifestJson).filter(
    (step) => typeof step.nodeId === "string" && step.nodeId.trim(),
  );

  if (steps.length === 0) {
    return {
      StartAt: "Done",
      States: {
        Done: {
          Type: "Succeed",
        },
      },
    };
  }

  const states = Object.fromEntries(
    steps.map((step, index) => {
      const next = steps[index + 1]?.nodeId;
      return [
        step.nodeId,
        {
          Type: "Pass",
          Comment: [step.runtime, step.stepType, step.label ?? step.nodeId]
            .filter(Boolean)
            .join(":"),
          ...(next ? { Next: next } : { End: true }),
        },
      ];
    }),
  );

  return {
    StartAt: steps[0].nodeId,
    States: states,
  };
}

function systemWorkflowSteps(stepManifestJson: unknown): RoutineConfigStep[] {
  return asList(stepManifestJson)
    .filter((step) => typeof step.nodeId === "string" && step.nodeId.trim())
    .map((step) => ({
      nodeId: step.nodeId,
      recipeId: String(step.runtime ?? step.stepType ?? "system"),
      recipeName: label(String(step.stepType ?? "System step")),
      label: String(step.label ?? step.nodeId),
      args: {
        runtime: step.runtime,
        stepType: step.stepType,
      },
      configFields: [],
    }));
}

const runColumns: ColumnDef<RunRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
    ),
    size: 100,
  },
  {
    accessorKey: "triggerSource",
    header: "Trigger",
    cell: ({ row }) => (
      <span className="text-sm">{label(row.original.triggerSource)}</span>
    ),
    size: 130,
  },
  {
    accessorKey: "domainRef",
    header: "Related Object",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.domainRef}
      </span>
    ),
  },
  {
    accessorKey: "startedAt",
    header: "Started",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.startedAt ? relativeTime(row.original.startedAt) : "—"}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: "finishedAt",
    header: "Finished",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.finishedAt ? relativeTime(row.original.finishedAt) : "—"}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: "errorCode",
    header: "Error",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.errorCode ?? "—"}
      </span>
    ),
    size: 120,
  },
];

function SystemWorkflowDetailPage() {
  const { tenantId } = useTenant();
  const { workflowId } = Route.useParams();
  const navigate = useNavigate();
  const [selectedWorkflowNodeId, setSelectedWorkflowNodeId] = useState<
    string | null
  >(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [result] = useQuery({
    query: SystemWorkflowDetailQuery,
    variables: { tenantId: tenantId!, id: workflowId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const workflow = result.data?.systemWorkflow;
  useBreadcrumbs([
    { label: "System Workflows", href: "/automations/system-workflows" },
    { label: workflow?.name ?? "Loading..." },
  ]);

  const configFields = useMemo(
    () => asList(workflow?.configSchemaJson),
    [workflow?.configSchemaJson],
  );
  const extensionPoints = useMemo(
    () => asList(workflow?.extensionPointsJson),
    [workflow?.extensionPointsJson],
  );
  const evidenceItems = useMemo(
    () => asList(workflow?.evidenceContractJson),
    [workflow?.evidenceContractJson],
  );
  const workflowAsl = useMemo(
    () => buildSystemWorkflowAsl(workflow?.stepManifestJson),
    [workflow?.stepManifestJson],
  );
  const workflowSteps = useMemo(
    () => systemWorkflowSteps(workflow?.stepManifestJson),
    [workflow?.stepManifestJson],
  );

  useEffect(() => {
    if (workflowSteps.length === 0) {
      setSelectedWorkflowNodeId(null);
      return;
    }
    if (
      !selectedWorkflowNodeId ||
      (!selectedWorkflowNodeId.endsWith(".__end") &&
        !workflowSteps.some((step) => step.nodeId === selectedWorkflowNodeId))
    ) {
      setSelectedWorkflowNodeId(workflowSteps[0]?.nodeId ?? null);
    }
  }, [selectedWorkflowNodeId, workflowSteps]);

  const runRows: RunRow[] = useMemo(
    () =>
      (workflow?.recentRuns ?? []).map((run) => ({
        id: run.id,
        status: run.status,
        triggerSource: run.triggerSource,
        domainRef:
          run.domainRefType && run.domainRefId
            ? `${run.domainRefType}:${run.domainRefId}`
            : "—",
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        createdAt: run.createdAt,
        errorCode: run.errorCode ?? null,
      })),
    [workflow?.recentRuns],
  );

  if (!tenantId || (result.fetching && !workflow)) return <PageSkeleton />;
  if (!workflow) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="System Workflow not found"
            description="No ThinkWork-owned workflow matches that id."
          />
        }
      />
    );
  }

  return (
    <PageLayout
      contentClassName="overflow-hidden pb-4"
      header={
        <PageHeader
          title={workflow.name}
          actions={<StatusBadge status={workflow.status.toLowerCase()} />}
        />
      }
    >
      <Tabs defaultValue="workflow" className="h-full min-h-0 gap-4">
        <TabsList
          variant="line"
          className="w-full shrink-0 justify-start border-b"
        >
          <TabsTrigger value="workflow" className="flex-none px-3">
            Workflow
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-3">
            Activity
          </TabsTrigger>
          <TabsTrigger value="config" className="flex-none px-3">
            Details
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="workflow"
          className="h-full min-h-0 overflow-hidden"
        >
          <div className="relative h-full min-h-0 overflow-hidden rounded-md border border-border/80 bg-background">
            <RoutineFlowCanvas
              mode="execution"
              aslJson={workflowAsl}
              stepManifestJson={workflow.stepManifestJson}
              selectedNodeId={selectedWorkflowNodeId}
              onSelectNode={setSelectedWorkflowNodeId}
              className="h-full min-h-0 rounded-none border-0"
              emptyLabel="No system workflow manifest available."
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="absolute right-3 top-3 z-20 xl:hidden"
              onClick={() => setDetailsOpen(true)}
            >
              <PanelRight className="h-3.5 w-3.5" />
              Details
            </Button>
            <div className="absolute inset-y-0 right-0 z-20 hidden w-[380px] min-h-0 overflow-y-auto border-l border-border/70 bg-card/95 shadow-2xl backdrop-blur xl:block">
              <RoutineFlowInspector
                mode="execution"
                selectedNodeId={selectedWorkflowNodeId}
                steps={workflowSteps}
                className="h-full rounded-none border-0 bg-transparent"
              />
            </div>
          </div>
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
            <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(420px,calc(100vw-2rem))]">
              <SheetHeader className="border-b border-border/70 pr-12">
                <SheetTitle>Node details</SheetTitle>
                <SheetDescription>
                  Inspect the selected system workflow step.
                </SheetDescription>
              </SheetHeader>
              <RoutineFlowInspector
                mode="execution"
                selectedNodeId={selectedWorkflowNodeId}
                steps={workflowSteps}
                className="rounded-none border-0 bg-transparent"
              />
            </SheetContent>
          </Sheet>
        </TabsContent>

        <TabsContent value="activity" className="overflow-y-auto">
          <DataTable
            columns={runColumns}
            data={runRows}
            tableClassName="table-fixed"
            pageSize={10}
            onRowClick={(row) =>
              navigate({
                to: "/automations/system-workflows/$workflowId/runs/$runId",
                params: { workflowId, runId: row.id },
              })
            }
          />
          {runRows.length === 0 && (
            <div className="rounded-md border px-3 py-6 text-sm text-muted-foreground">
              No runs recorded yet.
            </div>
          )}
        </TabsContent>

        <TabsContent value="config" className="space-y-4 overflow-y-auto">
          <section className="space-y-2 rounded-md border border-border/70 p-4">
            <h2 className="text-sm font-semibold">Description</h2>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              {workflow.description ?? "No description provided."}
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Definition</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Runtime</dt>
                  <dd>{label(workflow.runtimeShape)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd>{workflow.activeVersion}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd>{workflow.owner}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd>{label(workflow.evidenceStatus)}</dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Configuration</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd>{label(workflow.customizationStatus)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Config version</dt>
                  <dd>{workflow.activeConfig?.versionNumber ?? 0}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Activated</dt>
                  <dd>
                    {workflow.activeConfig?.activatedAt
                      ? formatDateTime(workflow.activeConfig.activatedAt)
                      : "Defaults"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Extension Points</h2>
              <div className="space-y-2">
                {extensionPoints.map((point) => (
                  <div key={point.id} className="text-sm">
                    <div className="font-medium">{point.label ?? point.id}</div>
                    <div className="text-xs text-muted-foreground">
                      {point.description ?? label(point.hookType)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Supported Configuration</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {configFields.map((field) => (
                <div key={field.key} className="rounded border px-3 py-2">
                  <div className="text-sm font-medium">
                    {field.label ?? field.key}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {label(field.inputType)}
                    {field.required ? " · Required" : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Evidence Contract</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {evidenceItems.map((item) => (
                <div key={item.type} className="rounded border px-3 py-2">
                  <div className="text-sm font-medium">
                    {item.label ?? item.type}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
