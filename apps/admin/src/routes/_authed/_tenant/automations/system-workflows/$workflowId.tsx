import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { SystemWorkflowDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";

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
      header={
        <PageHeader
          title={workflow.name}
          description={workflow.description ?? undefined}
          actions={<StatusBadge status={workflow.status.toLowerCase()} />}
        />
      }
    >
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

      <section className="mt-6 space-y-3 rounded-md border p-4">
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

      <section className="mt-6 space-y-3 rounded-md border p-4">
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

      <section className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold">Recent Runs</h2>
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
      </section>

      <div className="mt-6">
        <Button variant="outline" size="sm" asChild>
          <Link to="/automations/system-workflows">
            Back to System Workflows
          </Link>
        </Button>
      </div>
    </PageLayout>
  );
}
