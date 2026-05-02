import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { SystemWorkflowsListQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/system-workflows/",
)({
  component: SystemWorkflowsPage,
});

type SystemWorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  owner: string;
  runtimeShape: string;
  status: string;
  activeVersion: string;
  customizationStatus: string;
  evidenceStatus: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
};

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const columns: ColumnDef<SystemWorkflowRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
    ),
    size: 90,
  },
  {
    accessorKey: "name",
    header: "Workflow",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-medium whitespace-nowrap">{row.original.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {row.original.description ?? "ThinkWork-owned workflow"}
        </div>
      </div>
    ),
    size: 280,
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => (
      <span className="text-sm">{label(row.original.category)}</span>
    ),
    size: 110,
  },
  {
    accessorKey: "runtimeShape",
    header: "Runtime",
    cell: ({ row }) => (
      <span className="text-sm">{label(row.original.runtimeShape)}</span>
    ),
    size: 150,
  },
  {
    accessorKey: "lastRunAt",
    header: "Last Run",
    cell: ({ row }) => (
      <div className="text-xs text-muted-foreground">
        {row.original.lastRunAt
          ? relativeTime(row.original.lastRunAt)
          : "Never"}
      </div>
    ),
    size: 110,
  },
  {
    accessorKey: "lastRunStatus",
    header: "Run Status",
    cell: ({ row }) =>
      row.original.lastRunStatus ? (
        <StatusBadge
          status={row.original.lastRunStatus.toLowerCase()}
          size="sm"
        />
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 110,
  },
  {
    accessorKey: "activeVersion",
    header: "Version",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.activeVersion}
      </span>
    ),
    size: 130,
  },
  {
    accessorKey: "evidenceStatus",
    header: "Evidence",
    cell: ({ row }) => (
      <span className="text-sm">{label(row.original.evidenceStatus)}</span>
    ),
    size: 110,
  },
  {
    accessorKey: "customizationStatus",
    header: "Customization",
    cell: ({ row }) => (
      <span className="text-sm">{label(row.original.customizationStatus)}</span>
    ),
    size: 130,
  },
  {
    accessorKey: "owner",
    header: "Owner",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.owner}
      </span>
    ),
    size: 100,
  },
];

function SystemWorkflowsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  useBreadcrumbs([{ label: "System Workflows" }]);

  const [result] = useQuery({
    query: SystemWorkflowsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows: SystemWorkflowRow[] = useMemo(
    () =>
      (result.data?.systemWorkflows ?? []).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? null,
        category: workflow.category,
        owner: workflow.owner,
        runtimeShape: workflow.runtimeShape,
        status: workflow.status,
        activeVersion: workflow.activeVersion,
        customizationStatus: workflow.customizationStatus,
        evidenceStatus: workflow.evidenceStatus,
        lastRunAt:
          workflow.lastRun?.startedAt ?? workflow.lastRun?.createdAt ?? null,
        lastRunStatus: workflow.lastRun?.status ?? null,
      })),
    [result.data?.systemWorkflows],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;
  if (isLoading) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader
          title="System Workflows"
          description="ThinkWork-owned operating workflows with governed configuration, run history, and evidence."
        />
      }
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search system workflows..."
            className="pl-7 text-sm"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        tableClassName="table-fixed"
        pageSize={20}
        onRowClick={(row) =>
          navigate({
            to: "/automations/system-workflows/$workflowId",
            params: { workflowId: row.id },
          })
        }
      />
    </PageLayout>
  );
}
