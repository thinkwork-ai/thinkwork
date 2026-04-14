import { useNavigate } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  MessageSquare,
  Mail,
  MessagesSquare,
  CalendarClock,
  Bot,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useTenant } from "@/context/TenantContext";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBarSearch } from "@/components/ui/data-table-filter-bar";
import { ThreadsListQuery, OnThreadTurnUpdatedSubscription, OnThreadUpdatedSubscription } from "@/lib/graphql-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  type ActivityItem,
  TYPE_LABELS,
  TYPE_COLORS,
  STATUS_COLORS,
  mapThreads,
  formatCost,
  formatDuration,
} from "@/lib/activity-utils";

const activityChartConfig = {
  count: { label: "Activity", color: "hsl(217, 91%, 60%)" },
} satisfies ChartConfig;

function buildLast30DaysCounts(items: ActivityItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const d = new Date(item.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return days;
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
    <ChartContainer config={activityChartConfig} className="aspect-auto h-32 w-full -mt-2 mb-1">
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
          tickFormatter={(d: string) => {
            const date = new Date(d + "T00:00:00");
            return `${date.getMonth() + 1}/${date.getDate()}`;
          }}
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
                if (!day) return "";
                const date = new Date(day + "T00:00:00");
                return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              }}
            />
          }
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.day}
              fill="var(--color-count)"
              fillOpacity={selectedDay && selectedDay !== entry.day ? 0.25 : 0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function ActivityView() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [threadsResult, reexecuteThreads] = useQuery({
    query: ThreadsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const refreshAll = useCallback(() => {
    reexecuteThreads({ requestPolicy: "network-only" });
  }, [reexecuteThreads]);

  const [runSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (!runSub.data?.onThreadTurnUpdated) return;
    reexecuteThreads({ requestPolicy: "network-only" });
  }, [runSub.data, reexecuteThreads]);

  const [threadSub] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (!threadSub.data?.onThreadUpdated) return;
    reexecuteThreads({ requestPolicy: "network-only" });
  }, [threadSub.data, reexecuteThreads]);

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (threadsResult.data?.threads ?? []) as any[]) {
      if (t.agent) map.set(t.agent.id, t.agent.name);
    }
    return map;
  }, [threadsResult.data]);

  const allItems = useMemo<ActivityItem[]>(() => {
    const threads = (threadsResult.data?.threads ?? []) as any[];
    return mapThreads(threads, agentMap);
  }, [threadsResult.data, agentMap]);

  const filtered = useMemo(() => {
    let items = [...allItems].sort((a, b) => b.timestamp - a.timestamp);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.agentName?.toLowerCase().includes(q) ?? false),
      );
    }
    if (selectedDay) {
      items = items.filter((i) => {
        const d = new Date(i.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return key === selectedDay;
      });
    }
    return items;
  }, [allItems, search, selectedDay]);

  const handleRowClick = useCallback((item: ActivityItem) => {
    const threadId = item.sourceType === "thread" ? item.sourceId : item.threadId;
    if (threadId) {
      navigate({ to: "/threads/$threadId", params: { threadId } });
    }
  }, [navigate]);

  const columns = useMemo((): ColumnDef<ActivityItem>[] => [
    {
      id: "type",
      size: 120,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center pl-2">
            <Badge
              variant="secondary"
              className={cn("text-xs gap-1", TYPE_COLORS[item.type])}
            >
              {item.type === "chat" && <MessageSquare className="h-3 w-3" />}
              {item.type === "thread" && <MessagesSquare className="h-3 w-3" />}
              {item.type === "email" && <Mail className="h-3 w-3" />}
              {item.type === "scheduled" && <CalendarClock className="h-3 w-3" />}
              {item.type === "webhook" && <Webhook className="h-3 w-3" />}
              {(item.type === "routine" || item.type === "task") && <Bot className="h-3 w-3" />}
              {TYPE_LABELS[item.type]}
            </Badge>
          </div>
        );
      },
    },
    {
      id: "content",
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex h-10 items-center gap-2.5 pr-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>

            <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
              <Badge
                variant="secondary"
                className={cn("text-xs capitalize", STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground")}
              >
                {item.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs text-muted-foreground w-14 text-right tabular-nums">
                {formatDuration(item.duration)}
              </span>
              <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                {formatCost(item.cost)}
              </span>
              <span className="text-xs text-muted-foreground w-16 text-right">
                {relativeTime(new Date(item.timestamp).toISOString())}
              </span>
            </span>
          </div>
        );
      },
    },
  ], []);

  const isLoading = threadsResult.fetching && !threadsResult.data;
  if (!tenantId || isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {allItems.length} item{allItems.length !== 1 ? "s" : ""}
      </div>

      <ActivityChart items={allItems} selectedDay={selectedDay} onSelectDay={setSelectedDay} />

      <div className="flex items-center gap-2">
        <FilterBarSearch
          value={search}
          onChange={setSearch}
          placeholder="Search activity..."
          className="flex-1 max-w-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={refreshAll}>Refresh</Button>
      </div>

      {selectedDay && (
        <div className="flex items-center gap-2 py-1">
          <Badge variant="secondary" className="text-xs gap-1">
            {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </Badge>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedDay(null)}
          >
            Clear date filter
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity"
          description="Agent runs, chats, and threads will appear here."
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          hideHeader
          compact
          scrollable
          onRowClick={handleRowClick}
          tableClassName="table-fixed"
        />
      )}
    </div>
  );
}
