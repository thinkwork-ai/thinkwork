import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { graphql } from "@/gql";
import {
  MessagesSquare,
  Plus,
  ChevronRight,
  User,
  Search,
  Lock,
  MessageSquare,
  GitBranch,
  Archive,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialog } from "@/context/DialogContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusIcon } from "@/components/threads/StatusIcon";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  FilterBarSort,
  FilterBarGroup,
  FilterBarPopover,
  FilterBarFacet,
} from "@/components/ui/data-table-filter-bar";
import { ThreadsListQuery, ThreadsPagedQuery, AgentsListQuery, UpdateThreadMutation, OnThreadUpdatedSubscription, OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { cn, relativeTime } from "@/lib/utils";
import { useActiveTurnsStore } from "@/stores/active-turns-store";

export const Route = createFileRoute("/_authed/_tenant/threads/")({
  component: ThreadsPage,
});

/* ------------------------------------------------------------------ */
/* View state (persisted in localStorage)                             */
/* ------------------------------------------------------------------ */

type SortField = "title" | "created" | "updated";
type GroupBy = "assignee" | "none";

type ThreadViewState = {
  assignees: string[];
  sortField: SortField;
  sortDir: "asc" | "desc";
  groupBy: GroupBy;
  collapsedGroups: string[];
  showArchived: boolean;
};

const defaultViewState: ThreadViewState = {
  assignees: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  collapsedGroups: [],
  showArchived: false,
};

const SORT_FIELD_VALUES: readonly SortField[] = ["title", "created", "updated"];
const GROUP_BY_VALUES: readonly GroupBy[] = ["assignee", "none"];

// Defensive rehydrate: U3d/U4/U7 retired the task-era status/priority axis, so
// any prior session's localStorage may carry `statuses`, `priorities`, `viewMode`,
// or `sortField: "status" | "priority"` / `groupBy: "status"`. Strip unknown keys
// and coerce legacy values back to safe defaults rather than crashing or rendering
// empty. Self-heals on the user's next filter/sort/group change via saveViewState.
function getViewState(key: string): ThreadViewState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaultViewState };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaultViewState };
    const sortField: SortField = SORT_FIELD_VALUES.includes(parsed.sortField)
      ? parsed.sortField
      : defaultViewState.sortField;
    const groupBy: GroupBy = GROUP_BY_VALUES.includes(parsed.groupBy)
      ? parsed.groupBy
      : defaultViewState.groupBy;
    return {
      assignees: Array.isArray(parsed.assignees) ? parsed.assignees.filter((v: unknown) => typeof v === "string") : [],
      sortField,
      sortDir: parsed.sortDir === "asc" ? "asc" : "desc",
      groupBy,
      collapsedGroups: Array.isArray(parsed.collapsedGroups) ? parsed.collapsedGroups.filter((v: unknown) => typeof v === "string") : [],
      showArchived: parsed.showArchived === true,
    };
  } catch {
    return { ...defaultViewState };
  }
}

function saveViewState(key: string, state: ThreadViewState) {
  localStorage.setItem(key, JSON.stringify(state));
}

function getInboxStatus(
  threadId: string,
  lastTurnCompletedAt: any,
  lastReadAt: any,
  activeThreadIds: Set<string>,
): "running" | "unread" | "read" {
  if (activeThreadIds.has(threadId)) return "running";
  if (!lastTurnCompletedAt) return "read";
  if (!lastReadAt) return "unread";
  return new Date(lastTurnCompletedAt).getTime() > new Date(lastReadAt).getTime()
    ? "unread"
    : "read";
}

function InboxIndicator({ status }: { status: "running" | "unread" | "read" }) {
  if (status === "read") return null;
  if (status === "running") {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0" title="Agent running">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
      </span>
    );
  }
  // unread
  return (
    <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-primary" title="New response" />
  );
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (groups[key] ??= []).push(item);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Thread type (matches the GraphQL query shape)                      */
/* ------------------------------------------------------------------ */

type ThreadItem = {
  readonly id: string;
  readonly number: number;
  readonly identifier?: string | null;
  readonly title: string;
  readonly status: string;
  readonly agentId?: string | null;
  readonly agent?: { readonly id: string; readonly name: string; readonly avatarUrl?: string | null } | null;
  readonly assigneeType?: string | null;
  readonly assigneeId?: string | null;
  readonly checkoutRunId?: string | null;
  readonly lastActivityAt?: any;
  readonly lastTurnCompletedAt?: any;
  readonly lastReadAt?: any;
  readonly archivedAt?: any;
  readonly createdAt: any;
  readonly updatedAt: any;
};

/* ------------------------------------------------------------------ */
/* Filter-count helper                                                */
/* ------------------------------------------------------------------ */

function countActiveFilters(state: ThreadViewState): number {
  let count = 0;
  if (state.assignees.length > 0) count++;
  if (state.showArchived) count++;
  return count;
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

function ThreadsPage() {
  const { tenantId } = useTenant();
  const { openNewThread } = useDialog();
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Threads" }]);

  const VIEW_STATE_KEY = "thinkwork:threads-view";
  const scopedKey = tenantId ? `${VIEW_STATE_KEY}:${tenantId}` : VIEW_STATE_KEY;

  const [viewState, setViewState] = useState<ThreadViewState>(() => getViewState(scopedKey));
  const [issueSearch, setIssueSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const PAGE_SIZE = 50;
  const [pageIndex, setPageIndex] = useState(0);
  const [assigneePickerIssueId, setAssigneePickerIssueId] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");

  // Debounce search
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(issueSearch);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [issueSearch]);

  // Reload view state when tenant changes
  const prevScopedKey = useRef(scopedKey);
  useEffect(() => {
    if (prevScopedKey.current !== scopedKey) {
      prevScopedKey.current = scopedKey;
      setViewState(getViewState(scopedKey));
    }
  }, [scopedKey]);

  const updateView = useCallback((patch: Partial<ThreadViewState>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      saveViewState(scopedKey, next);
      return next;
    });
    // Reset to first page when filters/sort change
    if (patch.showArchived !== undefined || patch.sortField !== undefined || patch.sortDir !== undefined) {
      setPageIndex(0);
    }
  }, [scopedKey]);

  // GraphQL queries
  const [threadsResult, reexecuteThreads] = useQuery({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId!,
      search: debouncedSearch || undefined,
      showArchived: viewState.showArchived,
      sortField: viewState.sortField,
      sortDir: viewState.sortDir,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const totalCount = threadsResult.data?.threadsPaged?.totalCount ?? 0;

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [, updateThread] = useMutation(UpdateThreadMutation);

  // Live subscriptions — refetch threads list on updates
  const [threadSub] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (threadSub.data) reexecuteThreads({ requestPolicy: "network-only" });
  }, [threadSub.data, reexecuteThreads]);

  const [turnSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (turnSub.data) reexecuteThreads({ requestPolicy: "network-only" });
  }, [turnSub.data, reexecuteThreads]);

  const agents = agentsResult.data?.agents ?? [];
  const rawThreads: ThreadItem[] = (threadsResult.data?.threadsPaged?.items ?? [])
    .map((t: any) => ({
      ...t,
      status: t.status.toLowerCase(),
    }));

  const agentName = useCallback((id: string | null) => {
    if (!id) return null;
    return agents.find((a: any) => a.id === id)?.name ?? null;
  }, [agents]);

  // Assignee filtering remains client-side (not in server query)
  const filtered = useMemo(() => {
    if (viewState.assignees.length === 0) return rawThreads;
    return rawThreads.filter((thread) => {
      for (const assignee of viewState.assignees) {
        if (assignee === "__unassigned" && !thread.agentId && !thread.assigneeId) return true;
        if (thread.agentId === assignee) return true;
      }
      return false;
    });
  }, [rawThreads, viewState.assignees]);

  const activeFilterCount = countActiveFilters(viewState);

  const groupedContent = useMemo(() => {
    if (viewState.groupBy === "none") {
      return [{ key: "__all", label: null as string | null, items: filtered }];
    }
    // assignee
    const groups = groupBy(filtered, (t) => t.agentId ?? "__unassigned");
    return Object.keys(groups).map((key) => ({
      key,
      label: key === "__unassigned" ? "Unassigned" : (agentName(key) ?? key.slice(0, 8)),
      items: groups[key]!,
    }));
  }, [filtered, viewState.groupBy, agentName]);

  const newThreadDefaults = (groupKey?: string) => {
    const defaults: Record<string, string> = {};
    if (groupKey && viewState.groupBy === "assignee" && groupKey !== "__unassigned") {
      defaults.agentId = groupKey;
    }
    return defaults;
  };

  const handleUpdateThread = useCallback((id: string, data: Record<string, unknown>) => {
    const input: Record<string, unknown> = {};
    if (data.status) input.status = (data.status as string).toUpperCase();
    if (data.assigneeId !== undefined) input.assigneeId = data.assigneeId;
    if (data.assigneeType !== undefined) input.assigneeType = data.assigneeType;
    if (data.agentId !== undefined) {
      // When assigning to an agent via the assignee picker
      input.assigneeType = data.agentId ? "AGENT" : null;
      input.assigneeId = data.agentId || null;
    }
    updateThread({ id, input });
  }, [updateThread]);

  const assignThread = (threadId: string, agentId: string | null) => {
    handleUpdateThread(threadId, { agentId });
    setAssigneePickerIssueId(null);
    setAssigneeSearch("");
  };

  const activeThreadIds = useActiveTurnsStore((s) => s._activeThreadIds);

  const threadColumns: ColumnDef<ThreadItem>[] = useMemo(
    () => [
      {
        id: "row",
        cell: ({ row }) => {
          const thread = row.original;
          const inboxStatus = getInboxStatus(thread.id, thread.lastTurnCompletedAt, thread.lastReadAt, activeThreadIds);
          const identifier = thread.identifier ?? `#${thread.number}`;
          return (
            <div className="flex h-10 items-center gap-2 overflow-hidden pl-3 pr-3 text-sm sm:gap-3">
              {/* Leading: status + identifier */}
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className="shrink-0"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <StatusIcon
                    status={thread.status}
                    onChange={(s) => handleUpdateThread(thread.id, { status: s })}
                  />
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {identifier}
                </span>
                {thread.checkoutRunId && (
                  <Lock className="h-3 w-3 text-yellow-500 shrink-0" />
                )}
              </span>

              {/* Title */}
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>

              {/* Trailing */}
              <span className="ml-auto hidden shrink-0 items-center sm:flex">
                <Popover
                  open={assigneePickerIssueId === thread.id}
                  onOpenChange={(open) => {
                    setAssigneePickerIssueId(open ? thread.id : null);
                    if (!open) setAssigneeSearch("");
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      className="flex w-[160px] shrink-0 items-center justify-center rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      {thread.agent ? (
                        <Badge variant="outline" className="text-xs">
                          {thread.agent.name}
                        </Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                            <User className="h-3 w-3" />
                          </span>
                          Assignee
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-56 p-1"
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDownOutside={() => setAssigneeSearch("")}
                  >
                    <input
                      className="mb-1 w-full border-b border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
                      placeholder="Search agents..."
                      value={assigneeSearch}
                      onChange={(e) => setAssigneeSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="max-h-48 overflow-y-auto overscroll-contain">
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50",
                          !thread.agentId && "bg-accent",
                        )}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); assignThread(thread.id, null); }}
                      >
                        No assignee
                      </button>
                      {agents
                        .filter((agent: any) => {
                          if (!assigneeSearch.trim()) return true;
                          return agent.name.toLowerCase().includes(assigneeSearch.toLowerCase());
                        })
                        .map((agent: any) => (
                          <button
                            key={agent.id}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                              thread.agentId === agent.id && "bg-accent",
                            )}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); assignThread(thread.id, agent.id); }}
                          >
                            <span>{agent.name}</span>
                          </button>
                        ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <span className="w-[70px] text-right text-xs text-muted-foreground">{relativeTime(thread.lastActivityAt || thread.updatedAt)}</span>
                <span className="flex w-[20px] items-center justify-center">
                  <InboxIndicator status={inboxStatus} />
                </span>
              </span>
            </div>
          );
        },
      },
    ],
    [agents, assigneePickerIssueId, assigneeSearch, handleUpdateThread, assignThread, activeThreadIds],
  );

  if (!tenantId) return <PageSkeleton />;
  const isLoading = threadsResult.fetching && !threadsResult.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Threads"
            description={isLoading ? "Loading..." : `${totalCount} thread${totalCount !== 1 ? "s" : ""}${viewState.showArchived ? " (archived)" : ""}`}
          />

          {threadsResult.error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {threadsResult.error.message}
            </div>
          )}

          {/* Toolbar */}
          <div className="mt-4 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="relative w-48 sm:w-64 md:w-80">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={issueSearch}
              onChange={(e) => setIssueSearch(e.target.value)}
              placeholder="Search threads..."
              className="pl-7 text-xs sm:text-sm"
              aria-label="Search threads"
            />
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <FilterBarPopover
            activeCount={activeFilterCount}
            onClearAll={() => updateView({ assignees: [], showArchived: false })}
          >
            <FilterBarFacet
              label="Assignee"
              options={[
                { value: "__unassigned", label: "No assignee" },
                ...agents.map((a: any) => ({ value: a.id, label: a.name })),
              ]}
              selected={viewState.assignees}
              onChange={(assignees) => updateView({ assignees })}
            />

            <div className="border-t border-border" />

            <label className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Archive className="h-3.5 w-3.5" />
                Show archived only
              </span>
              <button
                role="switch"
                aria-checked={viewState.showArchived}
                onClick={() => updateView({ showArchived: !viewState.showArchived })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                  viewState.showArchived ? "bg-primary border-primary" : "bg-muted border-border"
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                  viewState.showArchived ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </label>
          </FilterBarPopover>

          <FilterBarSort
            options={[
              { value: "title", label: "Title" },
              { value: "created", label: "Created" },
              { value: "updated", label: "Last Activity" },
            ]}
            field={viewState.sortField}
            direction={viewState.sortDir}
            onChange={(field, dir) => updateView({ sortField: field as SortField, sortDir: dir })}
          />

          <FilterBarGroup
            options={[
              { value: "assignee", label: "Assignee" },
              { value: "none", label: "None" },
            ]}
            value={viewState.groupBy}
            onChange={(v) => updateView({ groupBy: v as GroupBy })}
          />
        </div>
      </div>
        </>
      }
    >
      {/* Empty state */}
      {filtered.length === 0 && (
        <EmptyState
          icon={MessagesSquare}
          title="No threads match the current filters or search."
          action={{ label: "New Thread", onClick: () => openNewThread(newThreadDefaults()) }}
        />
      )}

      {viewState.groupBy === "none" && filtered.length > 0 ? (
        <DataTable
          columns={threadColumns}
          data={filtered}
          hideHeader
          compact
          scrollable
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          pageIndex={pageIndex}
          onPageChange={setPageIndex}
          tableClassName="table-fixed"
          onRowClick={(thread) =>
            navigate({ to: "/threads/$threadId", params: { threadId: thread.id } })
          }
        />
      ) : (
        filtered.length > 0 && groupedContent.map((group) => (
          <Collapsible
            key={group.key}
            open={!viewState.collapsedGroups.includes(group.key)}
            onOpenChange={(open) => {
              updateView({
                collapsedGroups: open
                  ? viewState.collapsedGroups.filter((k) => k !== group.key)
                  : [...viewState.collapsedGroups, group.key],
              });
            }}
          >
            {group.label && (
              <div className="flex items-center py-1.5 pl-1 pr-3">
                <CollapsibleTrigger className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90" />
                  <span className="text-sm font-semibold uppercase tracking-wide">
                    {group.label}
                  </span>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 w-6 p-0 text-muted-foreground"
                  onClick={() => openNewThread(newThreadDefaults(group.key))}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CollapsibleContent>
              <DataTable
                columns={threadColumns}
                data={group.items}
                hideHeader
                compact
                tableClassName="table-fixed"
                onRowClick={(thread) =>
                  navigate({ to: "/threads/$threadId", params: { threadId: thread.id } })
                }
              />
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
    </PageLayout>
  );
}
