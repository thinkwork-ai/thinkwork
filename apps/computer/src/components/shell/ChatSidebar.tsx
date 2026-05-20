import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Ellipsis, MessageCircle, Plus, Search } from "lucide-react";
import { Button, Input, SidebarGroup, SidebarGroupLabel } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  ChatGlobalInboxQuery,
  SpacesQuery,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";
import { GlobalInboxSection } from "./GlobalInboxSection";
import { SpaceNavSection } from "./SpaceNavSection";
import {
  formatRelativeDate,
  groupThreadsByRecency,
  isThreadUnread,
  threadActivityAt,
  threadTitle,
  type ChatThreadSummary,
  type SpaceNavSummary,
} from "./chat-sidebar-types";

interface ThreadsPagedResult {
  threadsPaged?: {
    totalCount?: number | null;
    items?: ChatThreadSummary[] | null;
  } | null;
}

interface SpacesResult {
  spaces?: SpaceNavSummary[] | null;
}

const INBOX_LIMIT = 8;
const RECENT_LIMIT = 30;

export function ChatSidebar() {
  const { tenantId } = useTenant();
  const location = useRouterState({ select: (s) => s.location });
  const routeSpaceId = spaceIdFromThreadPath(location.pathname);
  const activeSpaceId =
    typeof location.search?.spaceId === "string"
      ? location.search.spaceId
      : routeSpaceId;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const [{ data: spacesData, fetching: spacesFetching, error: spacesError }] =
    useQuery<SpacesResult>({
      query: SpacesQuery,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const [{ data: inboxData, fetching: inboxFetching, error: inboxError }] =
    useQuery<ThreadsPagedResult>({
      query: ChatGlobalInboxQuery,
      variables: {
        tenantId: tenantId ?? "",
        limit: INBOX_LIMIT,
      },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const [{ data: recentData, fetching: recentFetching, error: recentError }] =
    useQuery<ThreadsPagedResult>({
      query: ThreadsPagedQuery,
      variables: {
        tenantId: tenantId ?? "",
        search: debouncedSearch.trim() || undefined,
        showArchived: false,
        sortField: "updated",
        sortDir: "desc",
        spaceId: activeSpaceId,
        limit: RECENT_LIMIT,
        offset: 0,
      },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const spaces = spacesData?.spaces ?? [];
  const inboxThreads = inboxData?.threadsPaged?.items ?? [];
  const recentThreads = recentData?.threadsPaged?.items ?? [];
  const activeSpace = activeSpaceId
    ? spaces.find((space) => space.id === activeSpaceId)
    : null;
  const recentGroups = useMemo(
    () => groupThreadsByRecency(recentThreads),
    [recentThreads],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-3 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/55" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 rounded-md border-sidebar-border bg-sidebar-accent/45 pl-9 text-sidebar-foreground placeholder:text-sidebar-foreground/55"
              placeholder="Search"
              aria-label="Search Chat threads"
            />
          </label>
          <Button asChild size="sm" className="h-9 shrink-0 gap-1.5">
            <Link to="/new">
              <MessageCircle className="size-4" />
              New
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="h-9 w-9 shrink-0 border-sidebar-border bg-sidebar"
            aria-label="Chat options"
            disabled
          >
            <Ellipsis className="size-4" />
          </Button>
        </div>
        {activeSpace ? (
          <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/30 px-2 py-1.5 text-xs text-sidebar-foreground/70">
            <span className="min-w-0 flex-1 truncate">
              Space:{" "}
              <span className="font-medium text-sidebar-foreground">
                {activeSpace.name ?? activeSpace.slug}
              </span>
            </span>
            <Link
              to="/threads"
              search={{}}
              className="shrink-0 font-medium text-sidebar-foreground hover:underline"
            >
              All
            </Link>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
        <GlobalInboxSection
          threads={inboxThreads}
          totalCount={inboxData?.threadsPaged?.totalCount ?? 0}
          isLoading={inboxFetching && !inboxData}
          error={inboxError?.message ?? null}
        />
        <SpaceNavSection
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          isLoading={spacesFetching && !spacesData}
          error={spacesError?.message ?? null}
        />
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="h-auto px-0 text-[0.78rem] font-semibold text-sidebar-foreground">
            {activeSpace ? activeSpace.name : "Conversations"}
          </SidebarGroupLabel>
          {recentError ? (
            <p className="rounded-md border border-destructive/40 px-2 py-2 text-xs text-destructive">
              {recentError.message}
            </p>
          ) : recentFetching && !recentData ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
              Loading conversations...
            </p>
          ) : recentThreads.length === 0 ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
              No conversations yet
            </p>
          ) : (
            <div className="space-y-3">
              {recentGroups.map((group) => (
                <div key={group.label}>
                  <div className="mb-1 px-2 text-xs font-semibold text-sidebar-foreground/80">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.threads.map((thread) => (
                      <ChatThreadRow
                        key={thread.id}
                        thread={thread}
                        active={
                          location.pathname === `/threads/${thread.id}` ||
                          location.pathname ===
                            `/spaces/${thread.spaceId}/threads/${thread.id}`
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SidebarGroup>
      </div>
    </div>
  );
}

function ChatThreadRow({
  thread,
  active,
}: {
  thread: ChatThreadSummary;
  active: boolean;
}) {
  const unread = isThreadUnread(thread);
  const activity = threadActivityAt(thread);
  const content = (
    <>
      <span
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{threadTitle(thread)}</span>
        <span className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-xs text-sidebar-foreground/50">
          <span className="truncate">
            {thread.space?.name ?? thread.identifier ?? "General"}
          </span>
          <span className="shrink-0">{formatRelativeDate(activity)}</span>
        </span>
      </span>
    </>
  );

  if (thread.spaceId) {
    return (
      <Link
        to="/spaces/$spaceId/threads/$threadId"
        params={{ spaceId: thread.spaceId, threadId: thread.id }}
        className={threadRowClass(active)}
      >
        {content}
      </Link>
    );
  }

  return (
    <Link
      to="/threads/$id"
      params={{ id: thread.id }}
      className={threadRowClass(active)}
    >
      {content}
    </Link>
  );
}

function threadRowClass(active: boolean) {
  return cn(
    "flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
}

function spaceIdFromThreadPath(pathname: string) {
  const match = /^\/spaces\/([^/]+)\/threads\/[^/]+/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}
