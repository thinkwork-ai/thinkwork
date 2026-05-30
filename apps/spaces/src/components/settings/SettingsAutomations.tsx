import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, Pause, Play, Zap } from "lucide-react";
import { Badge, DataTable, Input } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { apiFetch } from "@/lib/api-fetch";
import {
  formatSchedule,
  JOB_TYPE_LABELS,
  relativeTime,
  type ScheduledJobRow,
} from "@/routes/_authed/_shell/-automations.utils";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

function createdByLabel(row: ScheduledJobRow): string {
  switch (row.created_by_type) {
    case "user":
      return "User";
    case "agent":
      return "Agent";
    case "system":
      return "System";
    default:
      return "—";
  }
}

/**
 * Operator-wide view of every scheduled job in the tenant ("all automations").
 * The caller-scoped "my automations" view lives in the main-nav Automations
 * page.
 */
export function SettingsAutomations() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<ScheduledJobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!tenantId) return;
    setError(null);
    apiFetch<ScheduledJobRow[]>("/api/scheduled-jobs", {
      extraHeaders: { "x-tenant-id": tenantId },
    })
      .then((rows) => setJobs(rows))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<ScheduledJobRow[]>(() => jobs ?? [], [jobs]);

  const columns = useMemo<ColumnDef<ScheduledJobRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            {row.original.description ? (
              <span className="truncate text-xs text-muted-foreground">
                {row.original.description}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        size: 130,
        cell: ({ row }) => (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Zap className="h-3.5 w-3.5" />
            {JOB_TYPE_LABELS[row.original.trigger_type] ??
              row.original.trigger_type}
          </Badge>
        ),
      },
      {
        accessorKey: "schedule_expression",
        header: "Schedule",
        size: 160,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatSchedule(row.original.schedule_expression)}
          </span>
        ),
      },
      {
        id: "createdBy",
        header: "Owner",
        size: 90,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {createdByLabel(row.original)}
          </span>
        ),
      },
      {
        accessorKey: "enabled",
        header: "Status",
        size: 100,
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge
              variant="secondary"
              className="gap-1 bg-green-500/15 text-xs text-green-600 dark:text-green-400"
            >
              <Play className="h-3 w-3 fill-current" /> Active
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Pause className="h-3 w-3" /> Disabled
            </Badge>
          ),
      },
      {
        accessorKey: "last_run_at",
        header: "Last run",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.last_run_at
              ? relativeTime(row.original.last_run_at)
              : "Never"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <SettingsTablePane
      title="Automations"
      loading={!jobs && !error}
      toolbar={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Input
            placeholder="Search automations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        )
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
            to: "/settings/automations/$scheduledJobId",
            params: { scheduledJobId: row.id },
          })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No automations in this tenant yet.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
