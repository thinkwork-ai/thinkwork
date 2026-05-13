import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useSubscription } from "urql";
import {
  MessagesSquare,
  Plus,
  ChevronRight,
  Search,
  Archive,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialog } from "@/context/DialogContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  FilterBarSort,
  FilterBarGroup,
  FilterBarPopover,
  FilterBarFacet,
} from "@/components/ui/data-table-filter-bar";
import {
  ThreadsTable,
  computeThreadInboxStatus,
  type ThreadsTableItem,
} from "@/components/threads/ThreadsTable";
import {
  ThreadsPagedQuery,
  AgentsListQuery,
  UpdateThreadMutation,
  OnThreadUpdatedSubscription,
  OnThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useActiveTurnsStore } from "@/stores/active-turns-store";
import {
  threadAssigneeGroupKey,
  threadAssigneeGroupLabel,
} from "./-thread-grouping";

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

// `as const satisfies` pins the arrays to the SortField/GroupBy unions at
// definition — if the union grows and these tuples don't, TS fails at build.
const SORT_FIELD_VALUES = ["title", "created", "updated"] as const satisfies readonly SortField[];
const GROUP_BY_VALUES = ["assignee", "none"] as const satisfies readonly GroupBy[];

function isSortField(v: unknown): v is SortField {
  return typeof v === "string" && (SORT_FIELD_VALUES as readonly string[]).includes(v);
}

function isGroupBy(v: unknown): v is GroupBy {
  return typeof v === "string" && (GROUP_BY_VALUES as readonly string[]).includes(v);
}

// Defensive rehydrate: U3d/U4/U7 retired the task-era status/priority axis, so
// any prior session's localStorage may carry `statuses`, `priorities`, `viewMode`,
// or `sortField: "status" | "priority"` / `groupBy: "status"`. Strip unknown keys
// and coerce legacy values back to safe defaults rather than crashing or rendering
// empty. Self-heals on the user's next filter/sort/group change via saveViewState.
function getViewState(key: string): ThreadViewState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaultViewState };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaultViewState };
    const p = parsed as Record<string, unknown>;
    return {
      assignees: Array.isArray(p.assignees) ? p.assignees.filter((v): v is string => typeof v === "string") : [],
      sortField: isSortField(p.sortField) ? p.sortField : defaultViewState.sortField,
      // Any non-'asc' value (including undefined or a future third direction) falls to 'desc'.
      sortDir: p.sortDir === "asc" ? "asc" : "desc",
      groupBy: isGroupBy(p.groupBy) ? p.groupBy : defaultViewState.groupBy,
      collapsedGroups: Array.isArray(p.collapsedGroups) ? p.collapsedGroups.filter((v): v is string => typeof v === "string") : [],
      showArchived: p.showArchived === true,
    };
  } catch {
    return { ...defaultViewState };
  }
}

function saveViewState(key: string, state: ThreadViewState) {
  localStorage.setItem(key, JSON.stringify(state));
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (groups[key] ??= []).push(item);
  }
  return groups;
}

// Row type now lives in `@/components/threads/ThreadsTable` so the
// /threads route and the Computer Detail Dashboard render the same
// shape from the same source. Re-exported here so existing references
// inside this route stay terse.
type ThreadItem = ThreadsTableItem;

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

  // Debounce search
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(issueSearch);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [issueSearch]);

  // Reload view state when tenant changes. Reset pagination too — a stale
  // `pageIndex=N` against a smaller tenant produces an empty page because
  // offset=N*PAGE_SIZE overshoots the tenant's totalCount.
  const prevScopedKey = useRef(scopedKey);
  useEffect(() => {
    if (prevScopedKey.current !== scopedKey) {
      prevScopedKey.current = scopedKey;
      setViewState(getViewState(scopedKey));
      setPageIndex(0);
    }
  }, [scopedKey]);

  const updateView = useCallback((patch: Partial<ThreadViewState>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      saveViewState(scopedKey, next);
      return next;
    });
    // Reset to first page when filters/sort change.
    // `assignees` is included because the assignee facet narrows the effective
    // result set; leaving `pageIndex` stale on a narrowed set shows a blank
    // page at the previous offset.
    if (
      patch.assignees !== undefined ||
      patch.showArchived !== undefined ||
      patch.sortField !== undefined ||
      patch.sortDir !== undefined
    ) {
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

  // Assignee filtering remains client-side (not in server query).
  // Computer-owned threads (`thread.computerId` set) are not Unassigned —
  // they live in the synthetic "Computer" group when grouped by assignee, and
  // must be excluded from the Unassigned filter so the filter and grouping
  // axes do not diverge.
  const filtered = useMemo(() => {
    if (viewState.assignees.length === 0) return rawThreads;
    return rawThreads.filter((thread) => {
      for (const assignee of viewState.assignees) {
        if (
          assignee === "__unassigned" &&
          !thread.agentId &&
          !thread.assigneeId &&
          !thread.computerId
        )
          return true;
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
    // assignee — Computer ownership wins over Agent assignment so Computer-owned
    // threads land in a "Computer" group instead of being miscounted as Unassigned.
    const groups = groupBy(filtered, threadAssigneeGroupKey);
    return Object.keys(groups).map((key) => ({
      key,
      label: threadAssigneeGroupLabel(key, agentName),
      items: groups[key]!,
    }));
  }, [filtered, viewState.groupBy, agentName]);

  const newThreadDefaults = (groupKey?: string) => {
    const defaults: Record<string, string> = {};
    // Synthetic group keys (`__unassigned`, `__computer`) are not real agent IDs.
    // Only forward the key as `agentId` when it resolves to an actual agent row.
    if (
      groupKey &&
      viewState.groupBy === "assignee" &&
      groupKey !== "__unassigned" &&
      groupKey !== "__computer"
    ) {
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

  const activeThreadIds = useActiveTurnsStore((s) => s._activeThreadIds);

  const inboxStatusFor = useCallback(
    (thread: ThreadItem) =>
      computeThreadInboxStatus(
        thread.id,
        thread.lastTurnCompletedAt,
        thread.lastReadAt,
        activeThreadIds,
      ),
    [activeThreadIds],
  );

  const goToThread = useCallback(
    (threadId: string) =>
      navigate({ to: "/threads/$threadId", params: { threadId } }),
    [navigate],
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
        <ThreadsTable
          items={filtered}
          agents={agents}
          inboxStatusFor={inboxStatusFor}
          onUpdateThread={handleUpdateThread}
          onRowClick={goToThread}
          scrollable
          pagination={{
            totalCount,
            pageSize: PAGE_SIZE,
            pageIndex,
            onPageChange: setPageIndex,
          }}
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
              <ThreadsTable
                items={group.items}
                agents={agents}
                inboxStatusFor={inboxStatusFor}
                onUpdateThread={handleUpdateThread}
                onRowClick={goToThread}
              />
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
    </PageLayout>
  );
}
