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
  Input,
  type ChartConfig,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ThreadTurnUpdatedSubscription,
  ThreadUpdatedSubscription,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
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
  selectedDay?: string | null;
  onSelectedDayChange?: (day: string | null) => void;
}

export function SettingsActivity({
  selectedDay = null,
  onSelectedDayChange,
}: SettingsActivityProps) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

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
                {item.title}
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
        search: selectedDay ? { day: selectedDay } : {},
        state: (previous) => ({
          ...previous,
          threadTitleFallback: { threadId: item.threadId, title: item.title },
        }),
      });
    },
    [navigate, selectedDay],
  );

  const loading = fetching && !data;

  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    action: (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={refreshAll}
        disabled={fetching}
        aria-label="Refresh activity"
        title="Refresh activity"
      >
        <RefreshCw
          className={cn("h-4 w-4", fetching && "animate-spin")}
          aria-hidden="true"
        />
      </Button>
    ),
    actionKey: `activity-refresh:${fetching ? "fetching" : "idle"}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Activity
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recent thread activity across this workspace.
        </p>
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
            />
            {error ? (
              <p className="shrink-0 text-sm text-destructive">
                {error.message}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
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
}: {
  search: string;
  onSearchChange: (value: string) => void;
  itemCount: number;
  selectedDay: string | null;
  onClearDay: () => void;
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
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </span>
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
