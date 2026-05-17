import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Archive, Monitor, Plus, RefreshCw, Users } from "lucide-react";
import { ComputerFormDialog } from "@/components/computers/ComputerFormDialog";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FilterBarPopover,
  FilterBarSearch,
  FilterBarSort,
} from "@/components/ui/data-table-filter-bar";
import { ComputersListQuery } from "@/lib/graphql-queries";
import { formatUsd, relativeTime } from "@/lib/utils";
import { ComputerScope, ComputerStatus } from "@/gql/graphql";

export const Route = createFileRoute("/_authed/_tenant/computers/")({
  component: ComputersPage,
});

type ComputerRow = {
  id: string;
  name: string;
  accessLabel: string;
  historicalOwner: string | null;
  templateName: string | null;
  status: string;
  budgetMonthlyCents: number | null;
  spentMonthlyCents: number | null;
  lastHeartbeatAt: string | null;
  lastActiveAt: string | null;
};

type SortField = "name" | "accessLabel" | "status" | "lastHeartbeatAt";

function formatBudget(spent: number | null, budget: number | null): string {
  if (spent == null && budget == null) return "—";
  const spentLabel = spent == null ? "$0" : formatUsd(spent / 100, 0);
  const budgetLabel = budget == null ? "unbounded" : formatUsd(budget / 100, 0);
  return `${spentLabel} / ${budgetLabel}`;
}

const columns: ColumnDef<ComputerRow>[] = [
  {
    accessorKey: "name",
    header: "Computer",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
        <Monitor className="h-3.5 w-3.5 shrink-0 text-cyan-600" />
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "accessLabel",
    header: "Access",
    cell: ({ row }) => {
      const historicalOwner = row.original.historicalOwner;
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[170px]">
            {historicalOwner
              ? `Historical: ${historicalOwner}`
              : row.original.accessLabel}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
      </span>
    ),
    size: 110,
  },
  {
    accessorKey: "templateName",
    header: "Template",
    cell: ({ row }) =>
      row.original.templateName ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {row.original.templateName}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 150,
  },
  {
    accessorKey: "budgetMonthlyCents",
    header: "Budget",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatBudget(
          row.original.spentMonthlyCents,
          row.original.budgetMonthlyCents,
        )}
      </span>
    ),
    size: 130,
  },
  {
    accessorKey: "lastHeartbeatAt",
    header: "Heartbeat",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {row.original.lastHeartbeatAt
          ? relativeTime(row.original.lastHeartbeatAt)
          : "—"}
      </span>
    ),
    size: 130,
  },
];

function ComputersPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  useBreadcrumbs([{ label: "Computers" }]);

  const [result, reexecute] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const computers = result.data?.computers ?? [];
  const visibleComputers = useMemo(
    () =>
      showArchived
        ? computers
        : computers.filter((c) => c.status !== ComputerStatus.Archived),
    [computers, showArchived],
  );
  const rows: ComputerRow[] = useMemo(() => {
    const mapped = visibleComputers.map((computer) => ({
      id: computer.id,
      name: computer.name,
      accessLabel:
        computer.scope === ComputerScope.HistoricalPersonal
          ? "Historical personal"
          : "Shared",
      historicalOwner:
        computer.scope === ComputerScope.HistoricalPersonal
          ? (computer.owner?.name ?? computer.owner?.email ?? null)
          : null,
      templateName: computer.template?.name ?? null,
      status: computer.status,
      budgetMonthlyCents: computer.budgetMonthlyCents ?? null,
      spentMonthlyCents: computer.spentMonthlyCents ?? null,
      lastHeartbeatAt: computer.lastHeartbeatAt ?? null,
      lastActiveAt: computer.lastActiveAt ?? null,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    mapped.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      return dir * String(av).localeCompare(String(bv));
    });
    return mapped;
  }, [visibleComputers, sortField, sortDir]);

  const archivedCount = useMemo(
    () => computers.filter((c) => c.status === ComputerStatus.Archived).length,
    [computers],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Computers"
            description="Shared AWS-native workplaces with central runtime, workspace, and access management."
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => reexecute({ requestPolicy: "network-only" })}
                  disabled={result.fetching}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New Computer
                </Button>
              </>
            }
          />
          <div className="mt-4 flex items-center gap-2">
            <FilterBarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search computers..."
              className="w-56"
            />
            <FilterBarPopover
              activeCount={showArchived ? 1 : 0}
              onClearAll={() => setShowArchived(false)}
            >
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Archive className="h-3.5 w-3.5" />
                  Show archived
                  {archivedCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/70">
                      ({archivedCount})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    showArchived ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
                      showArchived ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </label>
            </FilterBarPopover>
            <div className="ml-auto">
              <FilterBarSort
                options={[
                  { value: "name", label: "Name" },
                  { value: "accessLabel", label: "Access" },
                  { value: "status", label: "Status" },
                  { value: "lastHeartbeatAt", label: "Heartbeat" },
                ]}
                field={sortField}
                direction={sortDir}
                onChange={(field, dir) => {
                  setSortField(field as SortField);
                  setSortDir(dir);
                }}
              />
            </div>
          </div>
        </>
      }
    >
      {result.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : computers.length === 0 && !isLoading ? (
        <EmptyState
          icon={Monitor}
          title="No Computers yet"
          description="Create a shared Computer and assign access to people."
          action={{
            label: "New Computer",
            onClick: () => setCreateOpen(true),
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          scrollable
          onRowClick={(row) =>
            navigate({
              to: "/computers/$computerId",
              params: { computerId: row.id },
              search: { tab: "dashboard" },
            })
          }
        />
      )}
      <ComputerFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(computerId) => {
          reexecute({ requestPolicy: "network-only" });
          navigate({
            to: "/computers/$computerId",
            params: { computerId },
            search: { tab: "dashboard" },
          });
        }}
      />
    </PageLayout>
  );
}
