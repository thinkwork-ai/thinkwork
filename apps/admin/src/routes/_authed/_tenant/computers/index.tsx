import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Monitor, RefreshCw, User } from "lucide-react";
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
  FilterBarSearch,
  FilterBarSort,
} from "@/components/ui/data-table-filter-bar";
import { ComputersListQuery } from "@/lib/graphql-queries";
import { formatUsd, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/computers/")({
  component: ComputersPage,
});

type ComputerRow = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  templateName: string | null;
  status: string;
  desiredRuntimeStatus: string;
  runtimeStatus: string;
  budgetMonthlyCents: number | null;
  spentMonthlyCents: number | null;
  lastHeartbeatAt: string | null;
  lastActiveAt: string | null;
  migratedFromAgentId: string | null;
};

type SortField =
  | "name"
  | "ownerName"
  | "status"
  | "runtimeStatus"
  | "lastHeartbeatAt";

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    accessorKey: "ownerName",
    header: "Owner",
    cell: ({ row }) => {
      const owner = row.original.ownerName ?? row.original.ownerEmail;
      return owner ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[150px]">{owner}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
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
    accessorKey: "runtimeStatus",
    header: "Runtime",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          Desired {label(row.original.desiredRuntimeStatus)}
        </Badge>
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {label(row.original.runtimeStatus)}
        </Badge>
      </div>
    ),
    size: 180,
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
  {
    accessorKey: "migratedFromAgentId",
    header: "Migration",
    cell: ({ row }) =>
      row.original.migratedFromAgentId ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          Migrated
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Native</span>
      ),
    size: 110,
  },
];

function ComputersPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  useBreadcrumbs([{ label: "Computers" }]);

  const [result, reexecute] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const computers = result.data?.computers ?? [];
  const rows: ComputerRow[] = useMemo(() => {
    const mapped = computers.map((computer) => ({
      id: computer.id,
      name: computer.name,
      ownerName: computer.owner?.name ?? null,
      ownerEmail: computer.owner?.email ?? null,
      templateName: computer.template?.name ?? null,
      status: computer.status,
      desiredRuntimeStatus: computer.desiredRuntimeStatus,
      runtimeStatus: computer.runtimeStatus,
      budgetMonthlyCents: computer.budgetMonthlyCents ?? null,
      spentMonthlyCents: computer.spentMonthlyCents ?? null,
      lastHeartbeatAt: computer.lastHeartbeatAt ?? null,
      lastActiveAt: computer.lastActiveAt ?? null,
      migratedFromAgentId: computer.migratedFromAgentId ?? null,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    mapped.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      return dir * String(av).localeCompare(String(bv));
    });
    return mapped;
  }, [computers, sortField, sortDir]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Computers"
            description="One durable AWS-native workplace per user, with live runtime state and migration provenance."
            actions={
              <Button
                variant="outline"
                onClick={() => reexecute({ requestPolicy: "network-only" })}
                disabled={result.fetching}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            }
          />
          <div className="mt-4 flex items-center gap-2">
            <FilterBarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search computers..."
              className="w-56"
            />
            <div className="ml-auto">
              <FilterBarSort
                options={[
                  { value: "name", label: "Name" },
                  { value: "ownerName", label: "Owner" },
                  { value: "status", label: "Status" },
                  { value: "runtimeStatus", label: "Runtime" },
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
          description="Run the Agent-to-Computer migration or provision users to create their durable workspaces."
          action={{
            label: "View People",
            onClick: () => navigate({ to: "/people" }),
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
            })
          }
        />
      )}
    </PageLayout>
  );
}
