import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { CircleDot, Crosshair, Plus, Zap } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Badge,
  DataTable,
  DataTableTokenFilter,
  TooltipIconButton,
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import { CollapsedFilterSearch } from "@/components/artifacts/CollapsedFilterSearch";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { StatusBadge } from "@/components/StatusBadge";
import { useTenant } from "@/context/TenantContext";
import {
  SpacesQuery,
  SettingsAgentLoopsQuery,
  SettingsGitRoutinesQuery,
  SettingsSaveAgentLoopMutation,
} from "@/lib/graphql-queries";
import {
  SettingsAgentProfilesQuery,
  SettingsTenantAgentQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import { AgentLoopForm } from "./AgentLoopForm";
import {
  buildMemberOptions,
  buildRoutineOptions,
  buildWorkerOptions,
  buildWorkflowOptions,
  type RoutineRow,
  type TenantMemberRow,
} from "./agent-loop-options";
import type { AgentLoopRow, SaveAgentLoopPayload } from "./agent-loop-types";
import {
  defaultSpaceIdFromAgentRuntimeConfig,
  formatShortDateTime,
  jsonRecord,
  readTargetSpec,
  stringValue,
  titleize,
} from "./agent-loop-utils";

export { buildWorkerOptions };

type AgentLoopsData = { agentLoops?: AgentLoopRow[] };
type AgentProfilesData = {
  agentProfiles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    enabled: boolean;
  }>;
};
type SpacesData = {
  spaces?: Array<{ id: string; name: string; slug?: string | null }>;
};
type TenantAgentData = {
  agent?: { id: string; name?: string | null; runtimeConfig?: unknown } | null;
};
type RoutinesData = { routines?: RoutineRow[] };
type MembersData = { tenantMembers?: TenantMemberRow[] };

const LOOP_FILTER_COLUMNS = {
  search: "loopSearch",
  status: "loopStatus",
  trigger: "loopTrigger",
  target: "loopTarget",
} as const;

function loopSearchText(row: AgentLoopRow): string {
  return [
    row.name,
    row.description ?? "",
    row.lifecycleStatus,
    triggerLabel(row),
    targetLabel(row),
  ]
    .join(" ")
    .toLowerCase();
}

function uniqueOptions(
  rows: AgentLoopRow[],
  getValue: (row: AgentLoopRow) => string,
) {
  return Array.from(new Set(rows.map(getValue).filter(Boolean))).sort();
}

function buildLoopFilterColumns(): ColumnDef<AgentLoopRow>[] {
  return [
    {
      id: LOOP_FILTER_COLUMNS.search,
      accessorFn: loopSearchText,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: LOOP_FILTER_COLUMNS.status,
      accessorFn: (row) => row.lifecycleStatus,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: LOOP_FILTER_COLUMNS.trigger,
      accessorFn: triggerLabel,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: LOOP_FILTER_COLUMNS.target,
      accessorFn: targetLabel,
      filterFn: dataTableTokenFilterFns.option,
    },
  ];
}

function buildLoopTokenFilterColumns(
  rows: AgentLoopRow[],
): DataTableTokenFilterColumn[] {
  return [
    {
      id: LOOP_FILTER_COLUMNS.status,
      label: "Status",
      type: "option",
      icon: <CircleDot className="size-4" />,
      options: uniqueOptions(rows, (row) => row.lifecycleStatus).map(
        (value) => ({ value, label: titleize(value) }),
      ),
    },
    {
      id: LOOP_FILTER_COLUMNS.trigger,
      label: "Trigger",
      type: "option",
      icon: <Zap className="size-4" />,
      options: uniqueOptions(rows, triggerLabel).map((value) => ({
        value,
        label: value,
      })),
    },
    {
      id: LOOP_FILTER_COLUMNS.target,
      label: "Target",
      type: "option",
      icon: <Crosshair className="size-4" />,
      options: uniqueOptions(rows, targetLabel).map((value) => ({
        value,
        label: value,
      })),
    },
  ];
}

function searchFilterText(filters: ColumnFiltersState): string {
  const value = filters.find(
    (filter) => filter.id === LOOP_FILTER_COLUMNS.search,
  )?.value;
  return value &&
    typeof value === "object" &&
    "value" in value &&
    typeof (value as { value: unknown }).value === "string"
    ? (value as { value: string }).value
    : "";
}

export function AgentLoopInventory({
  routeScope = "settings",
}: {
  routeScope?: "main" | "settings";
}) {
  const { tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [loopsResult, refetchLoops] = useQuery<AgentLoopsData>({
    query: SettingsAgentLoopsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [agentResult] = useQuery<TenantAgentData>({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [profilesResult] = useQuery<AgentProfilesData>({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [spacesResult] = useQuery<SpacesData>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [routinesResult] = useQuery<RoutinesData>({
    query: SettingsGitRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [membersResult] = useQuery<MembersData>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [, saveAgentLoop] = useMutation(SettingsSaveAgentLoopMutation);

  const workerOptions = useMemo(
    () =>
      buildWorkerOptions({
        agent: agentResult.data?.agent ?? null,
        profiles: profilesResult.data?.agentProfiles ?? [],
      }),
    [agentResult.data?.agent, profilesResult.data?.agentProfiles],
  );
  const spaceOptions = useMemo(
    () => spacesResult.data?.spaces ?? [],
    [spacesResult.data?.spaces],
  );
  const routineOptions = useMemo(
    () => buildRoutineOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const workflowOptions = useMemo(
    () => buildWorkflowOptions(routinesResult.data?.routines ?? []),
    [routinesResult.data?.routines],
  );
  const memberOptions = useMemo(
    () =>
      buildMemberOptions(
        membersResult.data?.tenantMembers ?? [],
        userId ? { id: userId, label: "You" } : null,
      ),
    [membersResult.data?.tenantMembers, userId],
  );
  const defaultSpaceId = useMemo(
    () =>
      defaultSpaceIdFromAgentRuntimeConfig(
        agentResult.data?.agent?.runtimeConfig,
      ),
    [agentResult.data?.agent?.runtimeConfig],
  );

  const rows = useMemo(
    () =>
      (loopsResult.data?.agentLoops ?? []).filter(
        (loop) => loop.lifecycleStatus !== "archived",
      ),
    [loopsResult.data?.agentLoops],
  );

  const filterColumns = useMemo(() => buildLoopFilterColumns(), []);
  const tokenFilterColumns = useMemo(
    () => buildLoopTokenFilterColumns(rows),
    [rows],
  );
  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredRows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable.getState().columnFilters, rows],
  );
  const searchValue = searchFilterText(columnFilters);
  const setSearchValue = (value: string) => {
    const trimmed = value.trimStart();
    filterTable
      .getColumn(LOOP_FILTER_COLUMNS.search)
      ?.setFilterValue(
        trimmed ? { operator: "contains", value: trimmed } : undefined,
      );
  };

  const columns = useMemo<ColumnDef<AgentLoopRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        // Name flexes to absorb leftover width; the other columns fit their
        // content and never force a horizontal scroll.
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <span
            className="block truncate font-medium"
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        id: "trigger",
        header: "Trigger",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {triggerLabel(row.original)}
          </Badge>
        ),
      },
      {
        id: "target",
        header: "Target",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-xs">
            {targetLabel(row.original)}
          </Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <StatusBadge status={row.original.lifecycleStatus} size="sm" />
        ),
      },
      {
        id: "lastRun",
        header: "Last run",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastRunAt
              ? formatShortDateTime(row.original.lastRunAt)
              : "Never"}
          </span>
        ),
      },
    ],
    [],
  );

  const openLoop = (id: string) => {
    if (routeScope === "main") {
      navigate({
        to: "/automations/$automationId",
        params: { automationId: id },
      });
      return;
    }
    navigate({
      to: "/settings/agent-loops/$agentLoopId",
      params: { agentLoopId: id },
    });
  };

  async function createLoop(payload: SaveAgentLoopPayload) {
    const result = await saveAgentLoop({ input: payload });
    if (result.error) throw result.error;
    const id = (result.data as { saveAgentLoop?: { id?: string } })
      ?.saveAgentLoop?.id;
    toast.success("Automation created");
    setCreating(false);
    refetchLoops({ requestPolicy: "network-only" });
    if (id) openLoop(id);
  }

  // Editing lives on the automation detail page — the inventory only creates.
  const dialogOpen = creating && Boolean(tenantId);
  const closeDialog = () => setCreating(false);

  return (
    <>
      {dialogOpen ? (
        <AgentLoopForm
          mode="create"
          tenantId={tenantId ?? ""}
          initialLoop={null}
          workerOptions={workerOptions}
          spaceOptions={spaceOptions}
          routineOptions={routineOptions}
          workflowOptions={workflowOptions}
          memberOptions={memberOptions}
          defaultSpaceId={defaultSpaceId}
          currentUserId={userId}
          onSubmit={createLoop}
          onCancel={closeDialog}
        />
      ) : null}
      <SettingsTablePane
        title="Automations"
        description="Create, run, and inspect recurring or webhook automations."
        loading={loopsResult.fetching && !loopsResult.data}
        headerActions={
          <TooltipIconButton
            type="button"
            label="New automation"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
          </TooltipIconButton>
        }
        headerActionKey="agent-loops-create"
        toolbar={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CollapsedFilterSearch
              value={searchValue}
              onChange={setSearchValue}
              label="Search automations"
              placeholder="Search automations..."
            />
            <DataTableTokenFilter
              table={filterTable}
              columns={tokenFilterColumns}
              addLabel="Filter"
              showAddLabel={false}
              clearLabel="Clear filters"
              flattenToolbar
              className="max-w-full [&_[data-token-filter-token]]:shrink-0"
              popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
            />
          </div>
        }
      >
        {loopsResult.error ? (
          <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
            {loopsResult.error.message}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredRows}
            scrollable
            allowHorizontalScroll={false}
            tableClassName="w-full table-auto"
            emptyState={
              <div className="py-12 text-center text-sm text-muted-foreground">
                No automations found.
              </div>
            }
            onRowClick={(row) => openLoop(row.id)}
          />
        )}
      </SettingsTablePane>
    </>
  );
}

export function triggerLabel(row: AgentLoopRow): string {
  const family = row.primaryTriggerFamily;
  if (family === "webhook") return "Webhook";
  if (family !== "schedule") return titleize(family);
  const trigger = jsonRecord(row.currentVersion?.triggerSpec);
  const config = jsonRecord(trigger.config);
  return stringValue(config.scheduleExpression, "Schedule");
}

export function targetLabel(row: AgentLoopRow): string {
  const target = readTargetSpec(row.currentVersion);
  if (target.kind === "routine") return "Routine";
  if (target.kind === "workflow") return "Workflow";
  return "Agent thread";
}
