import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Activity, MessageSquare, RefreshCw, Search } from "lucide-react";
import { Bar, BarChart, Cell, XAxis } from "recharts";
import { useQuery, useSubscription } from "urql";
import {
  Badge,
  Button,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  DataTable,
  DisplayViewControl,
  GroupedListView,
  Input,
  type ChartConfig,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { InlineShortcutText } from "@/components/workbench/InlineShortcutText";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ThreadTurnUpdatedSubscription,
  ThreadUpdatedSubscription,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  displayStateToSearch,
  groupDisplayRows,
  type DisplayGroupingOption,
  type DisplayListConfig,
  type DisplayListState,
  type DisplaySortOption,
} from "@/lib/list-view-display";
import {
  activityRecencyBucket,
  activityRecencyLabel,
  buildLast30DaysCounts,
  filterActivityItems,
  formatActivityDay,
  formatCost,
  formatDuration,
  mapThreadsToActivityItems,
  STATUS_COLORS,
  TYPE_COLORS,
  TYPE_LABELS,
  type ActivityItem,
  type ActivityThreadSummary,
} from "@/lib/settings-activity";

const RECENT_ACTIVITY_LIMIT = 200;
const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

type ActivityGroup = "recency" | "status" | "type" | "agent";
type ActivitySort =
  | "updated"
  | "title"
  | "status"
  | "type"
  | "cost"
  | "duration";
type ActivityProperty =
  | "status"
  | "type"
  | "agent"
  | "duration"
  | "cost"
  | "updated";

export type SettingsActivityDisplayState = DisplayListState<
  ActivityGroup,
  ActivitySort,
  ActivityProperty
>;

export const ACTIVITY_DISPLAY_CONFIG: DisplayListConfig<
  ActivityGroup,
  ActivitySort,
  ActivityProperty
> = {
  modes: ["table", "list"],
  groups: [
    { value: "none", label: "None" },
    { value: "recency", label: "Recency" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "agent", label: "Agent" },
  ],
  subgroups: [
    { value: "none", label: "None" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "agent", label: "Agent" },
  ],
  sorts: [
    { value: "updated", label: "Updated" },
    { value: "title", label: "Title" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "cost", label: "Cost" },
    { value: "duration", label: "Duration" },
  ],
  properties: [
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "agent", label: "Agent" },
    { value: "duration", label: "Duration" },
    { value: "cost", label: "Cost" },
    { value: "updated", label: "Updated" },
  ],
  defaults: {
    view: "table",
    group: "recency",
    subgroup: "status",
    sort: "updated",
    dir: "desc",
    showEmptyGroups: true,
    showEmptySubgroups: false,
    properties: ["status", "type", "agent", "duration", "cost", "updated"],
  },
};

const activityGroupingOptions: DisplayGroupingOption<
  ActivityGroup,
  ActivityItem
>[] = [
  {
    value: "recency",
    label: "Recency",
    group: (item) => activityRecencyBucket(item.timestamp),
    labelFor: activityRecencyLabel,
    emptyKeys: [
      { key: "today", label: "Today" },
      { key: "yesterday", label: "Yesterday" },
      { key: "last7", label: "Last 7 days" },
      { key: "older", label: "Older" },
      { key: "unknown", label: "Unknown" },
    ],
  },
  {
    value: "status",
    label: "Status",
    group: (item) => item.status,
    labelFor: (key) => key.replace(/_/g, " "),
  },
  {
    value: "type",
    label: "Type",
    group: (item) => item.type,
    labelFor: (key) => TYPE_LABELS[key as ActivityItem["type"]] ?? key,
  },
  {
    value: "agent",
    label: "Agent",
    group: (item) => item.agentName ?? "Unassigned",
    labelFor: (key) => key,
  },
];

const activitySortOptions: DisplaySortOption<ActivitySort, ActivityItem>[] = [
  {
    value: "updated",
    compare: (left, right) => left.timestamp - right.timestamp,
  },
  {
    value: "title",
    compare: (left, right) => left.title.localeCompare(right.title),
  },
  {
    value: "status",
    compare: (left, right) => left.status.localeCompare(right.status),
  },
  {
    value: "type",
    compare: (left, right) => left.type.localeCompare(right.type),
  },
  {
    value: "cost",
    compare: (left, right) => (left.cost ?? 0) - (right.cost ?? 0),
  },
  {
    value: "duration",
    compare: (left, right) => (left.duration ?? 0) - (right.duration ?? 0),
  },
];

const activityChartConfig = {
  count: { label: "Activity", color: "hsl(217, 91%, 60%)" },
} satisfies ChartConfig;

interface ThreadsPagedResult {
  threadsPaged?: {
    totalCount?: number | null;
    items?: ActivityThreadSummary[] | null;
  } | null;
}

interface SettingsActivityProps {
  /** When true, hosted inside the tabbed Activity page (which owns the page
   *  header); suppresses this view's own header publisher. */
  embedded?: boolean;
  selectedDay?: string | null;
  onSelectedDayChange?: (day: string | null) => void;
  displayState?: SettingsActivityDisplayState;
  onDisplayStateChange?: (state: SettingsActivityDisplayState) => void;
}

// Null-rendering header publisher (see SettingsContent's TablePaneHeader). Kept
// as a child so the embedded variant can suppress it without a conditional hook.
function ActivityHeader() {
  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
  });
  return null;
}

export function SettingsActivity({
  embedded,
  selectedDay = null,
  onSelectedDayChange,
  displayState = ACTIVITY_DISPLAY_CONFIG.defaults,
  onDisplayStateChange,
}: SettingsActivityProps) {
  const { isOperator, roleResolved, tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const description =
    roleResolved && !isOperator
      ? "Recent thread activity visible to you."
      : "Recent thread activity across this workspace.";

  const [{ data, fetching, error }, reexecuteThreads] =
    useQuery<ThreadsPagedResult>({
      query: ThreadsPagedQuery,
      variables: {
        tenantId: tenantId ?? "",
        showArchived: false,
        sortField: "updated",
        sortDir: "desc",
        limit: RECENT_ACTIVITY_LIMIT,
        offset: 0,
      },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const refreshAll = useCallback(() => {
    reexecuteThreads({ requestPolicy: "network-only" });
  }, [reexecuteThreads]);

  const [threadSub] = useSubscription({
    query: ThreadUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  useEffect(() => {
    if (threadSub.data?.onThreadUpdated) refreshAll();
  }, [refreshAll, threadSub.data]);

  const [turnSub] = useSubscription({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  useEffect(() => {
    if (turnSub.data?.onThreadTurnUpdated) refreshAll();
  }, [refreshAll, turnSub.data]);

  const allItems = useMemo(
    () => mapThreadsToActivityItems(data?.threadsPaged?.items ?? []),
    [data?.threadsPaged?.items],
  );
  const filtered = useMemo(
    () => filterActivityItems(allItems, { search, day: selectedDay }),
    [allItems, search, selectedDay],
  );
  const listGroups = useMemo(
    () =>
      groupDisplayRows({
        rows: filtered,
        group: displayState.group,
        subgroup: displayState.subgroup,
        sort: displayState.sort,
        dir: displayState.dir,
        showEmptyGroups: displayState.showEmptyGroups,
        showEmptySubgroups: displayState.showEmptySubgroups,
        groupingOptions: activityGroupingOptions,
        sortOptions: activitySortOptions,
      }),
    [displayState, filtered],
  );

  const columns = useMemo<ColumnDef<ActivityItem>[]>(
    () => [
      {
        id: "type",
        size: 118,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <span className={`${COMPACT_TABLE_CELL} pl-4`}>
              <Badge
                variant="secondary"
                className={cn(
                  "gap-1 whitespace-nowrap text-xs",
                  TYPE_COLORS[item.type],
                )}
              >
                <MessageSquare className="h-3 w-3" />
                {TYPE_LABELS[item.type]}
              </Badge>
            </span>
          );
        },
      },
      {
        id: "content",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <span className={`${COMPACT_TABLE_CELL} gap-2.5 pr-3`}>
              <span className="min-w-0 flex-1 truncate font-medium">
                <InlineShortcutText
                  text={item.title}
                  fallbackAgentProfiles
                  fallbackMentions
                  fallbackSkills
                />
              </span>
              <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
                <Badge
                  variant="secondary"
                  className={cn(
                    "max-w-32 truncate text-xs capitalize",
                    STATUS_COLORS[item.status] ??
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {item.status.replace(/_/g, " ")}
                </Badge>
                <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                  {formatDuration(item.duration)}
                </span>
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                  {formatCost(item.cost)}
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">
                  {item.timestamp
                    ? relativeTime(new Date(item.timestamp).toISOString())
                    : "—"}
                </span>
              </span>
            </span>
          );
        },
      },
    ],
    [],
  );

  const handleSelectDay = useCallback(
    (day: string | null) => {
      onSelectedDayChange?.(day);
    },
    [onSelectedDayChange],
  );

  const handleRowClick = useCallback(
    (item: ActivityItem) => {
      navigate({
        to: "/settings/activity/$threadId",
        params: { threadId: item.threadId },
        search: {
          ...displayStateToSearch(displayState, ACTIVITY_DISPLAY_CONFIG),
          ...(selectedDay ? { day: selectedDay } : {}),
        },
        state: (previous) => ({
          ...previous,
          threadTitleFallback: { threadId: item.threadId, title: item.title },
        }),
      });
    },
    [displayState, navigate, selectedDay],
  );

  const loading = fetching && !data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <ActivityHeader />}
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Threads
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <ActivityChart
              items={allItems}
              selectedDay={selectedDay}
              onSelectDay={handleSelectDay}
            />
            <ActivityToolbar
              search={search}
              onSearchChange={setSearch}
              itemCount={allItems.length}
              selectedDay={selectedDay}
              onClearDay={() => handleSelectDay(null)}
              onRefresh={refreshAll}
              fetching={fetching}
              displayControl={
                <DisplayViewControl
                  state={displayState}
                  modes={[
                    { value: "table", label: "Table" },
                    { value: "list", label: "List" },
                  ]}
                  groups={ACTIVITY_DISPLAY_CONFIG.groups}
                  subgroups={ACTIVITY_DISPLAY_CONFIG.subgroups}
                  sorts={ACTIVITY_DISPLAY_CONFIG.sorts}
                  properties={ACTIVITY_DISPLAY_CONFIG.properties}
                  onStateChange={onDisplayStateChange ?? (() => {})}
                />
              }
            />
            {error ? (
              <p className="shrink-0 text-sm text-destructive">
                {error.message}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              {displayState.view === "list" ? (
                <GroupedListView
                  groups={listGroups}
                  getRowId={(item) => item.id}
                  renderRow={(item) => (
                    <ActivityListRow
                      item={item}
                      properties={displayState.properties}
                      onClick={() => handleRowClick(item)}
                    />
                  )}
                  emptyState={
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                      <Activity className="h-5 w-5" />
                      <span>No activity</span>
                    </div>
                  }
                  data-testid="activity-list-view"
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={filtered}
                  hideHeader
                  scrollable
                  allowHorizontalScroll={false}
                  pageSize={10}
                  tableClassName="table-fixed"
                  onRowClick={handleRowClick}
                  emptyState={
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                      <Activity className="h-5 w-5" />
                      <span>No activity</span>
                    </div>
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityToolbar({
  search,
  onSearchChange,
  itemCount,
  selectedDay,
  onClearDay,
  onRefresh,
  fetching,
  displayControl,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  itemCount: number;
  selectedDay: string | null;
  onClearDay: () => void;
  onRefresh: () => void;
  fetching: boolean;
  displayControl?: React.ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2"
      data-testid="activity-toolbar"
    >
      <label className="relative min-w-56 flex-1 sm:w-80 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
          placeholder="Search activity..."
          aria-label="Search activity"
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={fetching}
        aria-label="Refresh activity"
        title="Refresh activity"
      >
        <RefreshCw
          className={cn("h-4 w-4", fetching && "animate-spin")}
          aria-hidden="true"
        />
      </Button>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </span>
      {displayControl}
      {selectedDay ? (
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="whitespace-nowrap text-xs">
            {formatActivityDay(selectedDay)}
          </Badge>
          <button
            type="button"
            className="whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={onClearDay}
          >
            Clear date filter
          </button>
        </span>
      ) : null}
    </div>
  );
}

function ActivityListRow({
  item,
  properties,
  onClick,
}: {
  item: ActivityItem;
  properties: ActivityProperty[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-3 text-left"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        <InlineShortcutText
          text={item.title}
          fallbackAgentProfiles
          fallbackMentions
          fallbackSkills
        />
      </span>
      <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5">
        {properties.map((property) => (
          <ActivityPropertyChip
            key={property}
            item={item}
            property={property}
          />
        ))}
      </span>
    </button>
  );
}

function ActivityPropertyChip({
  item,
  property,
}: {
  item: ActivityItem;
  property: ActivityProperty;
}) {
  switch (property) {
    case "status":
      return (
        <Badge
          variant="secondary"
          className={cn(
            "max-w-32 truncate text-xs capitalize",
            STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {item.status.replace(/_/g, " ")}
        </Badge>
      );
    case "type":
      return (
        <Badge
          variant="secondary"
          className={cn(
            "gap-1 whitespace-nowrap text-xs",
            TYPE_COLORS[item.type],
          )}
        >
          <MessageSquare className="h-3 w-3" />
          {TYPE_LABELS[item.type]}
        </Badge>
      );
    case "agent":
      return (
        <span className="text-xs text-muted-foreground">
          {item.agentName ?? "Unassigned"}
        </span>
      );
    case "duration":
      return (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDuration(item.duration)}
        </span>
      );
    case "cost":
      return (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatCost(item.cost)}
        </span>
      );
    case "updated":
      return (
        <span className="text-xs text-muted-foreground">
          {item.timestamp
            ? relativeTime(new Date(item.timestamp).toISOString())
            : "—"}
        </span>
      );
  }
}

function ActivityChart({
  items,
  selectedDay,
  onSelectDay,
}: {
  items: ActivityItem[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const data = useMemo(() => buildLast30DaysCounts(items), [items]);

  return (
    <ChartContainer
      config={activityChartConfig}
      className="aspect-auto h-32 w-full"
      data-testid="activity-chart"
    >
      <BarChart
        data={data}
        onClick={(state) => {
          if (!state?.activePayload?.[0]) return;
          const day = state.activePayload[0].payload.day as string;
          onSelectDay(selectedDay === day ? null : day);
        }}
        className="cursor-pointer"
      >
        <XAxis
          dataKey="day"
          interval="equidistantPreserveStart"
          tickFormatter={(day: string) => formatActivityDay(day)}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => {
                const day = payload[0]?.payload?.day;
                return day ? formatActivityDay(day) : "";
              }}
            />
          }
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.day}
              fill="var(--color-count)"
              fillOpacity={
                selectedDay && selectedDay !== entry.day ? 0.25 : 0.85
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function SettingsActivityLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoadingShimmer />
    </div>
  );
}
