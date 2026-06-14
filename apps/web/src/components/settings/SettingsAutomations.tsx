import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, Pause, Play } from "lucide-react";
import {
  Badge,
  DataTable,
  DisplayViewControl,
  GroupedListView,
  Input,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { apiFetch } from "@/lib/api-fetch";
import {
  displayStateToSearch,
  groupDisplayRows,
  type DisplayGroupingOption,
  type DisplayListConfig,
  type DisplayListState,
  type DisplaySortOption,
} from "@/lib/list-view-display";
import {
  formatSchedule,
  JOB_TYPE_LABELS,
  relativeTime,
  type ScheduledJobRow,
} from "@/routes/_authed/_shell/-automations.utils";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

type AutomationGroup = "status" | "type" | "owner";
type AutomationSort = "name" | "lastRun" | "schedule" | "status" | "type";
type AutomationProperty = "type" | "schedule" | "owner" | "status" | "lastRun";

export type SettingsAutomationsDisplayState = DisplayListState<
  AutomationGroup,
  AutomationSort,
  AutomationProperty
>;

export const AUTOMATIONS_DISPLAY_CONFIG: DisplayListConfig<
  AutomationGroup,
  AutomationSort,
  AutomationProperty
> = {
  modes: ["table", "list"],
  groups: [
    { value: "none", label: "None" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "owner", label: "Owner" },
  ],
  subgroups: [
    { value: "none", label: "None" },
    { value: "type", label: "Type" },
    { value: "owner", label: "Owner" },
    { value: "status", label: "Status" },
  ],
  sorts: [
    { value: "name", label: "Name" },
    { value: "lastRun", label: "Last run" },
    { value: "schedule", label: "Schedule" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
  ],
  properties: [
    { value: "type", label: "Type" },
    { value: "schedule", label: "Schedule" },
    { value: "owner", label: "Owner" },
    { value: "status", label: "Status" },
    { value: "lastRun", label: "Last run" },
  ],
  defaults: {
    view: "table",
    group: "status",
    subgroup: "type",
    sort: "name",
    dir: "asc",
    showEmptyGroups: true,
    showEmptySubgroups: false,
    properties: ["type", "schedule", "owner", "lastRun"],
  },
};

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

function jobStatus(row: ScheduledJobRow): "active" | "disabled" {
  return row.enabled ? "active" : "disabled";
}

function statusLabel(status: string): string {
  return status === "active" ? "Active" : "Disabled";
}

const automationGroupingOptions: DisplayGroupingOption<
  AutomationGroup,
  ScheduledJobRow
>[] = [
  {
    value: "status",
    label: "Status",
    group: (row) => jobStatus(row),
    labelFor: statusLabel,
    emptyKeys: [
      { key: "active", label: "Active" },
      { key: "disabled", label: "Disabled" },
    ],
  },
  {
    value: "type",
    label: "Type",
    group: (row) => row.trigger_type,
    labelFor: (key) => JOB_TYPE_LABELS[key] ?? key,
  },
  {
    value: "owner",
    label: "Owner",
    group: createdByLabel,
    labelFor: (key) => key,
  },
];

const automationSortOptions: DisplaySortOption<
  AutomationSort,
  ScheduledJobRow
>[] = [
  {
    value: "name",
    compare: (left, right) => left.name.localeCompare(right.name),
  },
  {
    value: "lastRun",
    compare: (left, right) =>
      timestamp(left.last_run_at) - timestamp(right.last_run_at),
  },
  {
    value: "schedule",
    compare: (left, right) =>
      formatSchedule(left.schedule_expression).localeCompare(
        formatSchedule(right.schedule_expression),
      ),
  },
  {
    value: "status",
    compare: (left, right) => jobStatus(left).localeCompare(jobStatus(right)),
  },
  {
    value: "type",
    compare: (left, right) =>
      left.trigger_type.localeCompare(right.trigger_type),
  },
];

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Operator-wide view of every scheduled job in the tenant ("all automations").
 * The caller-scoped "my automations" view lives in the main-nav Automations
 * page.
 */
export function SettingsAutomations({
  displayState = AUTOMATIONS_DISPLAY_CONFIG.defaults,
  onDisplayStateChange,
}: {
  displayState?: SettingsAutomationsDisplayState;
  onDisplayStateChange?: (state: SettingsAutomationsDisplayState) => void;
}) {
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
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [rows, search]);
  const listGroups = useMemo(
    () =>
      groupDisplayRows({
        rows: filteredRows,
        group: displayState.group,
        subgroup: displayState.subgroup,
        sort: displayState.sort,
        dir: displayState.dir,
        showEmptyGroups: displayState.showEmptyGroups,
        showEmptySubgroups: displayState.showEmptySubgroups,
        groupingOptions: automationGroupingOptions,
        sortOptions: automationSortOptions,
      }),
    [displayState, filteredRows],
  );

  const openJob = useCallback(
    (row: ScheduledJobRow) =>
      navigate({
        to: "/settings/automations/$scheduledJobId",
        params: { scheduledJobId: row.id },
        search: displayStateToSearch(displayState, AUTOMATIONS_DISPLAY_CONFIG),
      }),
    [displayState, navigate],
  );

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
        header: () => <div className="text-center">Type</div>,
        size: 130,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Badge variant="secondary" className="text-xs">
              {JOB_TYPE_LABELS[row.original.trigger_type] ??
                row.original.trigger_type}
            </Badge>
          </div>
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
      description="Schedule recurring agent jobs and review their run history."
      loading={!jobs && !error}
      headerActionKey={JSON.stringify(displayState)}
      headerActions={
        error ? undefined : (
          <DisplayViewControl
            state={displayState}
            modes={[
              { value: "table", label: "Table" },
              { value: "list", label: "List" },
            ]}
            groups={AUTOMATIONS_DISPLAY_CONFIG.groups}
            subgroups={AUTOMATIONS_DISPLAY_CONFIG.subgroups}
            sorts={AUTOMATIONS_DISPLAY_CONFIG.sorts}
            properties={AUTOMATIONS_DISPLAY_CONFIG.properties}
            onStateChange={onDisplayStateChange ?? (() => {})}
            triggerVariant="icon"
            triggerLabel="Display"
          />
        )
      }
      toolbar={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              placeholder="Search automations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
        )
      }
    >
      {displayState.view === "list" ? (
        <GroupedListView
          groups={listGroups}
          getRowId={(row) => row.id}
          renderRow={(row) => (
            <AutomationListRow
              row={row}
              properties={displayState.properties}
              onClick={() => openJob(row)}
            />
          )}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              No automations in this tenant yet.
            </div>
          }
          data-testid="automations-list-view"
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          filterColumn="name"
          scrollable
          allowHorizontalScroll={false}
          pageSize={25}
          tableClassName="table-fixed"
          onRowClick={openJob}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              No automations in this tenant yet.
            </div>
          }
        />
      )}
    </SettingsTablePane>
  );
}

function AutomationListRow({
  row,
  properties,
  onClick,
}: {
  row: ScheduledJobRow;
  properties: AutomationProperty[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-3 text-left"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.name}</span>
        {row.description ? (
          <span className="block truncate text-xs text-muted-foreground">
            {row.description}
          </span>
        ) : null}
      </span>
      <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {properties.map((property) => (
          <AutomationPropertyChip
            key={property}
            row={row}
            property={property}
          />
        ))}
      </span>
    </button>
  );
}

function AutomationPropertyChip({
  row,
  property,
}: {
  row: ScheduledJobRow;
  property: AutomationProperty;
}) {
  switch (property) {
    case "type":
      return (
        <Badge variant="secondary" className="text-xs">
          {JOB_TYPE_LABELS[row.trigger_type] ?? row.trigger_type}
        </Badge>
      );
    case "schedule":
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {formatSchedule(row.schedule_expression)}
        </span>
      );
    case "owner":
      return (
        <span className="text-xs text-muted-foreground">
          {createdByLabel(row)}
        </span>
      );
    case "status":
      return row.enabled ? (
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
      );
    case "lastRun":
      return (
        <span className="text-xs text-muted-foreground">
          {row.last_run_at ? relativeTime(row.last_run_at) : "Never"}
        </span>
      );
  }
}
