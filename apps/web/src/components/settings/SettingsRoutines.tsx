import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { SettingsRoutinesQuery } from "@/lib/settings-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

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
  const navigate = useNavigate();
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

  return (
    <SettingsTablePane
      title="Workflows"
      description="Manage imported Step Functions workflows and review their runs."
      loading={result.fetching && !result.data}
      toolbar={
        <Input
          placeholder="Search workflows..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/settings/routines/$routineId",
            params: { routineId: row.id },
          })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No workflows yet.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
