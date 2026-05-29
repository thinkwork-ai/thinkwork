import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input, Skeleton } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { SettingsRoutinesQuery } from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
} from "@/components/settings/SettingsContent";

type RoutineRow = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  lastRunAt?: string | null;
  createdAt?: unknown;
};

function relativeTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function SettingsRoutines() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [result] = useQuery({
    query: SettingsRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const rows = useMemo<RoutineRow[]>(
    () => (result.data?.routines ?? []) as RoutineRow[],
    [result.data],
  );

  const columns = useMemo<ColumnDef<RoutineRow>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "active" ? "default" : "secondary"}
          >
            {row.original.status}
          </Badge>
        ),
      },
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-muted-foreground">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "lastRunAt",
        header: "Last run",
        size: 120,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.lastRunAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (result.fetching && !result.data) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Routines" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsPane className="max-w-5xl">
      <SettingsHeader
        title="Routines"
        description="Scheduled agent runs for this tenant."
      />
      <div className="mb-4">
        <Input
          placeholder="Search routines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="name"
        pageSize={20}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No routines yet.
          </div>
        }
      />
    </SettingsPane>
  );
}
