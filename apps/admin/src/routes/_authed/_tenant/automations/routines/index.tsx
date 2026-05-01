import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Search, Clock, Bot, CalendarClock } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { RoutinesListQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/automations/routines/")({
  component: RoutinesPage,
});

type RoutineRow = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  schedule: string | null;
  agentName: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

const columns: ColumnDef<RoutineRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
    ),
    size: 100,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.original.type}
      </Badge>
    ),
    size: 100,
  },
  {
    accessorKey: "schedule",
    header: "Schedule",
    cell: ({ row }) =>
      row.original.schedule ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          {row.original.schedule}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 140,
  },
  {
    accessorKey: "agentName",
    header: "Agent",
    cell: ({ row }) =>
      row.original.agentName ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Bot className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[120px]">{row.original.agentName}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 140,
  },
  {
    accessorKey: "lastRunAt",
    header: "Last Run",
    cell: ({ row }) =>
      row.original.lastRunAt ? (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.lastRunAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never</span>
      ),
    size: 120,
  },
  {
    accessorKey: "nextRunAt",
    header: "Next Run",
    cell: ({ row }) =>
      row.original.nextRunAt ? (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.nextRunAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    size: 120,
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
      routines.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        type: r.type,
        status: r.status,
        schedule: r.schedule ?? null,
        agentName: r.agent?.name ?? null,
        lastRunAt: r.lastRunAt ?? null,
        nextRunAt: r.nextRunAt ?? null,
      })),
    [routines],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={<PageHeader title="Routines" />}
    >
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
          <Link to="/automations/schedules" search={{ type: "routine" }}>
            <CalendarClock className="h-4 w-4 mr-1" />
            Schedules
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
