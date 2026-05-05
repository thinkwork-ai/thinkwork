import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { KeyRound, Plus, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoutinesListQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/automations/routines/")({
  component: RoutinesPage,
});

type RoutineRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  lastRunAt: string | null;
  createdAt: string;
};

const columns: ColumnDef<RoutineRow>[] = [
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
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap">{row.original.name}</span>
    ),
    size: 240,
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="text-muted-foreground text-sm truncate overflow-hidden">
        {row.original.description ?? "—"}
      </div>
    ),
  },
  {
    accessorKey: "lastRunAt",
    header: "Last Execution",
    cell: ({ row }) =>
      row.original.lastRunAt ? (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.lastRunAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never</span>
      ),
    size: 130,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {relativeTime(row.original.createdAt)}
      </span>
    ),
    size: 90,
  },
];

function RoutinesPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  useBreadcrumbs([{ label: "Routines" }]);

  const [result] = useQuery({
    query: RoutinesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const routines = result.data?.routines ?? [];

  const rows: RoutineRow[] = useMemo(
    () =>
      routines
        // Phase E U15: hide legacy Python routines. Phase A introduced
        // the engine partition so the operator-facing list stays focused
        // on the Step Functions substrate; legacy_python rows are
        // archived in migration 0057 and not actionable from this UI.
        .filter((r: any) => r.engine !== "legacy_python")
        .map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          status: r.status,
          lastRunAt: r.lastRunAt ?? null,
          createdAt: r.createdAt,
        })),
    [routines],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout header={<PageHeader title="Routines" />}>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search routines..."
            className="pl-7 text-sm"
          />
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" asChild>
          <Link to="/automations/credentials">
            <KeyRound className="h-4 w-4 mr-1" />
            Credentials
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link to="/automations/routines/new">
            <Plus className="h-4 w-4 mr-1" />
            New Routine
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/automations/routines/$routineId",
            params: { routineId: row.id },
          })
        }
      />
    </PageLayout>
  );
}
