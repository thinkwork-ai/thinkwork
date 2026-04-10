import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useMemo, useState, useCallback } from "react";
import {
  MessageSquare,
  MessagesSquare,
  CalendarClock,
  Bot,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Webhook,
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgentsListQuery, ThreadsListQuery, ThreadTurnsQuery, ThreadDetailQuery } from "@/lib/graphql-queries";
import { cn, relativeTime, formatUsd } from "@/lib/utils";
import { useCostData } from "@/hooks/useCostData";
import { useCostStore } from "@/stores/cost-store";
import {
  type ActivityItem,
  TYPE_LABELS,
  TYPE_COLORS,
  STATUS_COLORS,
  mapRuns,
  mapThreads,
} from "@/lib/activity-utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/_authed/_tenant/dashboard")({
  component: DashboardPage,
});

const PAGE_SIZE = 10;

function DashboardPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Dashboard" }]);

  const [activityPage, setActivityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);

  // Activity dialogs
  const [viewingRun, setViewingRun] = useState<any | null>(null);
  const [viewingThread, setViewingThread] = useState<ActivityItem | null>(null);

  const handleActivityClick = useCallback((item: ActivityItem) => {
    if (item.sourceType === "thread") setViewingThread(item);
    else if (item.sourceType === "ticket_turn" && item.runData) setViewingRun(item.runData);
  }, []);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [threadsResult] = useQuery({
    query: ThreadsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [runsResult] = useQuery({
    query: ThreadTurnsQuery,
    variables: { tenantId: tenantId!, limit: 100 },
    pause: !tenantId,
  });

  useCostData(tenantId);

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (threadsResult.data?.threads ?? []) as any[]) {
      if (t.agent) map.set(t.agent.id, t.agent.name);
    }
    return map;
  }, [threadsResult.data]);

  const allActivityItems = useMemo<ActivityItem[]>(() => {
    const threads = (threadsResult.data?.threads ?? []) as any[];
    const runs = ((runsResult.data as any)?.threadTurns ?? []) as any[];
    const items = [
      ...mapRuns(runs, agentMap),
      ...mapThreads(threads, agentMap),
    ];
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [threadsResult.data, runsResult.data, agentMap]);

  if (!tenantId) return <PageSkeleton />;

  const agents = agentsResult.data?.agents ?? [];
  const threads = threadsResult.data?.threads ?? [];

  const onlineAgents = agents.filter((a: any) => a.status === "IDLE" || a.status === "BUSY");
  const openThreads = threads.filter((t: any) => t.status !== "DONE" && t.status !== "CANCELLED");

  const activitySlice = allActivityItems.slice(activityPage * PAGE_SIZE, (activityPage + 1) * PAGE_SIZE);
  const activityTotalPages = Math.ceil(allActivityItems.length / PAGE_SIZE);

  const threadSlice = threads.slice(threadPage * PAGE_SIZE, (threadPage + 1) * PAGE_SIZE);
  const threadTotalPages = Math.ceil(threads.length / PAGE_SIZE);

  return (
    <PageLayout
      header={<PageHeader title="Dashboard" description="Overview of your workspace" />}
    >
      <div className="space-y-6">
        {/* Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
          <MetricCard label="Agents Online" value={`${onlineAgents.length} / ${agents.length}`} href="/agents" />
          <MetricCard label="Open Threads" value={openThreads.length} href="/threads" />
          <MetricCard label="Recent Activity" value={allActivityItems.length} href="/activity" />
          <SpendMetric />
          <CostPerEventMetric />
        </div>

        {/* Recent Activity + Recent Threads */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Activity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Recent Activity</h3>
              <Link to="/activity" className="text-xs text-muted-foreground hover:text-foreground">
                View all
              </Link>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              {allActivityItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No activity yet</p>
              ) : (
                activitySlice.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors text-left"
                    onClick={() => handleActivityClick(item)}
                  >
                    <Badge variant="secondary" className={cn("text-xs gap-1 shrink-0", TYPE_COLORS[item.type])}>
                      {item.type === "chat" && <MessageSquare className="h-3 w-3" />}
                      {item.type === "thread" && <MessagesSquare className="h-3 w-3" />}
                      {item.type === "scheduled" && <CalendarClock className="h-3 w-3" />}
                      {item.type === "webhook" && <Webhook className="h-3 w-3" />}
                      {(item.type === "routine" || item.type === "task") && <Bot className="h-3 w-3" />}
                      {TYPE_LABELS[item.type]}
                    </Badge>
                    <span className="text-sm font-medium truncate min-w-0 flex-1">{item.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {relativeTime(new Date(item.timestamp).toISOString())}
                    </span>
                  </button>
                ))
              )}
            </div>
            {activityTotalPages > 1 && (
              <Pager page={activityPage} totalPages={activityTotalPages} onPageChange={setActivityPage} />
            )}
          </div>

          {/* Threads */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Recent Threads</h3>
              <Link to="/threads" className="text-xs text-muted-foreground hover:text-foreground">
                View all
              </Link>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              {threads.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No threads yet</p>
              ) : (
                (threadSlice as any[]).map(( thread: any) => (
                  <Link
                    key={thread.id}
                    to="/threads/$threadId"
                    params={{ threadId: thread.id }}
                    className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors"
                  >
                    <StatusBadge status={thread.status.toLowerCase()} size="sm" />
                    <span className="text-sm font-medium truncate min-w-0 flex-1">
                      <span className="text-muted-foreground mr-1.5">#{thread.number}</span>
                      {thread.title}
                    </span>
                    {thread.agent && (
                      <Badge variant="secondary" className="text-xs gap-1 shrink-0 bg-muted text-muted-foreground">
                        <Bot className="h-3 w-3" />
                        {thread.agent.name}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {relativeTime(thread.createdAt)}
                    </span>
                  </Link>
                ))
              )}
            </div>
            {threadTotalPages > 1 && (
              <Pager page={threadPage} totalPages={threadTotalPages} onPageChange={setThreadPage} />
            )}
          </div>
        </div>
      </div>

      {/* Activity detail dialogs */}
      <RunDetailDialog run={viewingRun} open={!!viewingRun} onOpenChange={(o) => { if (!o) setViewingRun(null); }} />
      <ThreadDetailDialog item={viewingThread} open={!!viewingThread} onOpenChange={(o) => { if (!o) setViewingThread(null); }} navigate={navigate} />
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

function Pager({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>Page {page + 1} of {totalPages}</span>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon-xs" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-xs" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend metric
// ---------------------------------------------------------------------------

function SpendMetric() {
  const totalUsd = useCostStore((s) => s.summary?.totalUsd ?? 0);
  return (
    <MetricCard
      label="Spend (MTD)"
      value={formatUsd(totalUsd)}
      href="/costs"
    />
  );
}

function CostPerEventMetric() {
  const totalUsd = useCostStore((s) => s.summary?.totalUsd ?? 0);
  const eventCount = useCostStore((s) => s.summary?.eventCount ?? 0);
  const costPerEvent = eventCount > 0 ? totalUsd / eventCount : 0;
  return (
    <MetricCard
      label="Cost / Event"
      value={eventCount > 0 ? formatUsd(costPerEvent) : "—"}
      href="/costs"
    />
  );
}

// ---------------------------------------------------------------------------
// Activity detail dialogs (same as activity page)
// ---------------------------------------------------------------------------

function RunDetailDialog({ run, open, onOpenChange }: { run: any | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!run) return null;
  const parseJson = (v: unknown): any => {
    if (!v) return null;
    if (typeof v === "string") { try { return parseJson(JSON.parse(v)); } catch { return null; } }
    return v;
  };
  const resultJson = parseJson(run.resultJson);
  const usageJson = parseJson(run.usageJson);
  const rawResponse = (resultJson?.response ?? resultJson?.result) as string | undefined;
  const responseText = rawResponse?.replace(/```[\w]*\n?/g, "");
  const durationMs = usageJson?.duration_ms as number | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[75vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Run Details
            <Badge variant="secondary" className={cn("text-xs capitalize", STATUS_COLORS[run.status?.toLowerCase()] ?? "")}>
              {run.status?.toLowerCase()}
            </Badge>
            {durationMs != null && <span className="text-xs text-muted-foreground">{(durationMs / 1000).toFixed(1)}s</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {run.triggerName && <div><span className="text-muted-foreground">Trigger</span><p className="font-medium">{run.triggerName}</p></div>}
            <div><span className="text-muted-foreground">Source</span><p className="capitalize">{(run.invocationSource ?? "").replace(/_/g, " ")}</p></div>
            <div><span className="text-muted-foreground">Started</span><p>{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Queued"}</p></div>
            <div><span className="text-muted-foreground">Finished</span><p>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "..."}</p></div>
          </div>
          {responseText && (
            <div>
              <span className="text-muted-foreground text-xs">Response</span>
              <div className="mt-1 bg-muted/50 rounded-md p-3 text-sm prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{responseText}</ReactMarkdown>
              </div>
            </div>
          )}
          {run.error && (
            <div>
              <span className="text-muted-foreground text-xs">Error</span>
              <pre className="mt-1 whitespace-pre-wrap text-destructive bg-destructive/5 rounded-md p-3 text-sm">{run.error}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadDetailDialog({ item, open, onOpenChange, navigate }: { item: ActivityItem | null; open: boolean; onOpenChange: (open: boolean) => void; navigate: ReturnType<typeof useNavigate> }) {
  const [result] = useQuery({
    query: ThreadDetailQuery,
    variables: { id: item?.sourceId ?? "" },
    pause: !item || !open,
    requestPolicy: "network-only",
  });

  const thread = result.data?.thread;
  const comments = thread?.comments ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[75vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <MessagesSquare className="h-4 w-4 shrink-0 text-rose-500" />
            <span className="truncate">{item?.title ?? "Thread"}</span>
            {item && (
              <Badge variant="secondary" className={cn("text-xs capitalize shrink-0", STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground")}>
                {item.status.replace(/_/g, " ")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {result.fetching && <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>}
        {thread && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {thread.agent && <div><span className="text-muted-foreground text-xs">Agent</span><p>{thread.agent.name}</p></div>}
              {thread.createdAt && <div><span className="text-muted-foreground text-xs">Created</span><p>{new Date(thread.createdAt).toLocaleString()}</p></div>}
            </div>
            {thread.description && (
              <>
                <Separator />
                <div><span className="text-xs text-muted-foreground">Description</span><p className="mt-1 text-sm whitespace-pre-wrap">{thread.description}</p></div>
              </>
            )}
            {comments.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <span className="text-xs text-muted-foreground">Comments ({comments.length})</span>
                  {(comments as any[]).map((c: any) => (
                    <div key={c.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium capitalize">{c.authorType?.toLowerCase().replace(/_/g, " ") ?? "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <Separator />
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onOpenChange(false); navigate({ to: "/threads/$threadId", params: { threadId: item!.sourceId } }); }}>
            <ExternalLink className="h-3.5 w-3.5" /> Open thread
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
