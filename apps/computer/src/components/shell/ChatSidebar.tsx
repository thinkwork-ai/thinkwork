import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Anchor,
  Archive,
  ArrowLeft,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Keyboard,
  MessageCirclePlus,
  Monitor,
  Paperclip,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  DeleteThreadMutation,
  SpacesQuery,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";
import {
  clearMissingThreadDeletes,
  setThreadDeletePending,
  usePendingThreadDeletes,
} from "@/lib/pending-thread-deletes";
import { cn } from "@/lib/utils";
import {
  formatTinyRelativeDate,
  isThreadUnread,
  selectNextThreadBelowDeleted,
  sortThreadsByActivityDesc,
  threadActivityAt,
  threadTitle,
  type ChatThreadSummary,
} from "./chat-sidebar-types";

interface ThreadsPagedResult {
  threadsPaged?: {
    totalCount?: number | null;
    items?: ChatThreadSummary[] | null;
  } | null;
}

interface SpaceNavSummary {
  id: string;
  slug?: string | null;
  name?: string | null;
  unreadThreadCount?: number | null;
}

interface SpacesResult {
  spaces?: SpaceNavSummary[] | null;
}

const RECENT_LIMIT = 60;
const SEARCH_LIMIT = 30;
const SECTION_THREAD_LIMIT = 5;

export function ChatSidebar() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const routeSpaceId = spaceIdFromThreadPath(location.pathname);
  const routeThreadId = threadIdFromThreadPath(location.pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    routeThreadId,
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pendingThreadDeletes = usePendingThreadDeletes();
  const recentThreadOrderRef = useRef<ChatThreadSummary[]>([]);
  const pendingThreadDeletesRef = useRef(pendingThreadDeletes);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [{ data: spacesData, fetching: spacesFetching, error: spacesError }] =
    useQuery<SpacesResult>({
      query: SpacesQuery,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const spaces = spacesData?.spaces ?? [];
  const defaultSpaceIds = useMemo(
    () => new Set(spaces.filter(isDefaultSpace).map((space) => space.id)),
    [spaces],
  );

  const [
    { data: recentData, fetching: recentFetching, error: recentError },
    reexecuteRecentThreadsQuery,
  ] = useQuery<ThreadsPagedResult>({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId ?? "",
      showArchived: false,
      sortField: "updated",
      sortDir: "desc",
      limit: RECENT_LIMIT,
      offset: 0,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [
    { data: searchData, fetching: searchFetching, error: searchError },
    reexecuteSearchThreadsQuery,
  ] = useQuery<ThreadsPagedResult>({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId ?? "",
      search: debouncedSearch.trim() || undefined,
      showArchived: false,
      sortField: "updated",
      sortDir: "desc",
      limit: SEARCH_LIMIT,
      offset: 0,
    },
    pause: !tenantId || !searchOpen,
    requestPolicy: "cache-and-network",
  });

  useEffect(() => {
    if (routeThreadId) {
      setSelectedThreadId(routeThreadId);
    } else if (location.pathname === "/new") {
      setSelectedThreadId(undefined);
    }
  }, [location.pathname, routeThreadId]);

  useEffect(() => {
    if (!recentData?.threadsPaged?.items) return;
    clearMissingThreadDeletes(
      recentData.threadsPaged.items.map((thread) => thread.id),
    );
  }, [recentData?.threadsPaged?.items]);

  const orderedRecentThreads = useMemo(
    () => sortThreadsByActivityDesc(recentData?.threadsPaged?.items ?? []),
    [recentData?.threadsPaged?.items],
  );

  useEffect(() => {
    recentThreadOrderRef.current = orderedRecentThreads;
    pendingThreadDeletesRef.current = pendingThreadDeletes;
  }, [orderedRecentThreads, pendingThreadDeletes]);

  useEffect(() => {
    function handleThreadDeleted(event: Event) {
      const detail = (event as CustomEvent<ThreadDeletedDetail>).detail;
      const deletedThreadId = detail?.threadId;
      const nextThreadId = deletedThreadId
        ? selectNextThreadBelowDeleted(
            recentThreadOrderRef.current,
            deletedThreadId,
            pendingThreadDeletesRef.current,
          )
        : null;

      reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
      reexecuteSearchThreadsQuery({ requestPolicy: "network-only" });

      if (nextThreadId) {
        setSelectedThreadId(nextThreadId);
        void navigate({
          to: "/threads/$id",
          params: { id: nextThreadId },
          replace: true,
        });
      } else {
        setSelectedThreadId(undefined);
        void navigate({
          to: "/new",
          search: { spaceId: undefined },
          replace: true,
        });
      }
    }

    function handleThreadSelected(event: Event) {
      const detail = (event as CustomEvent<ThreadSelectedDetail>).detail;
      if (!detail?.threadId) return;
      setSelectedThreadId(detail.threadId);
    }

    window.addEventListener("thinkwork:thread-deleted", handleThreadDeleted);
    window.addEventListener("thinkwork:thread-selected", handleThreadSelected);
    return () => {
      window.removeEventListener(
        "thinkwork:thread-deleted",
        handleThreadDeleted,
      );
      window.removeEventListener(
        "thinkwork:thread-selected",
        handleThreadSelected,
      );
    };
  }, [navigate, reexecuteRecentThreadsQuery, reexecuteSearchThreadsQuery]);

  const recentThreads = useMemo(
    () =>
      orderedRecentThreads.filter(
        (thread) => !pendingThreadDeletes.has(thread.id),
      ),
    [orderedRecentThreads, pendingThreadDeletes],
  );
  const genericThreads = useMemo(
    () =>
      recentThreads.filter(
        (thread) => !thread.spaceId || defaultSpaceIds.has(thread.spaceId),
      ),
    [defaultSpaceIds, recentThreads],
  );
  const spaceThreadsById = useMemo(() => {
    const grouped = new Map<string, ChatThreadSummary[]>();
    for (const thread of recentThreads) {
      if (!thread.spaceId || defaultSpaceIds.has(thread.spaceId)) continue;
      const list = grouped.get(thread.spaceId) ?? [];
      list.push(thread);
      grouped.set(thread.spaceId, list);
    }
    return grouped;
  }, [defaultSpaceIds, recentThreads]);
  const contextualSpaces = useMemo(
    () =>
      spaces.filter(
        (space) =>
          !defaultSpaceIds.has(space.id) &&
          (spaceThreadsById.get(space.id)?.length ?? 0) > 0,
      ),
    [defaultSpaceIds, spaceThreadsById, spaces],
  );
  const searchThreads = useMemo(
    () =>
      sortThreadsByActivityDesc(searchData?.threadsPaged?.items ?? []).filter(
        (thread) => !pendingThreadDeletes.has(thread.id),
      ),
    [pendingThreadDeletes, searchData?.threadsPaged?.items],
  );

  if (settingsOpen) {
    return (
      <>
        <SettingsNav onBack={() => setSettingsOpen(false)} />
        <ThreadSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          search={search}
          onSearchChange={setSearch}
          threads={searchThreads}
          isLoading={searchFetching && !searchData}
          error={searchError?.message ?? null}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-3 group-data-[collapsible=icon]:hidden">
        <nav className="space-y-1" aria-label="Chat actions">
          <Button asChild variant="ghost" className={navItemClassName}>
            <Link to="/new" search={{ spaceId: undefined }}>
              <MessageCirclePlus className="size-4 shrink-0" />
              <span>New thread</span>
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={navItemClassName}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 text-left">Search</span>
            <span className="text-xs text-sidebar-foreground/45">⌘K</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={navItemClassName}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4 shrink-0" />
            <span>Settings</span>
          </Button>
        </nav>
      </div>

      <div className="scrollbar-auto-hide min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
        <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
          {recentError ? (
            <p className="rounded-md border border-destructive/40 px-2 py-2 text-xs text-destructive">
              {recentError.message}
            </p>
          ) : recentFetching && !recentData ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
              Loading threads...
            </p>
          ) : recentThreads.length === 0 &&
            contextualSpaces.length === 0 &&
            !spacesFetching ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
              No threads yet
            </p>
          ) : (
            <div className="space-y-3">
              <ThreadListSection
                label="Pinned"
                threads={[]}
                selectedThreadId={selectedThreadId}
                defaultOpen={false}
                emptyBehavior="hidden"
                onActivate={setSelectedThreadId}
              />
              <ThreadListSection
                label="Chats"
                threads={genericThreads}
                selectedThreadId={selectedThreadId}
                defaultOpen
                emptyBehavior="message"
                onActivate={setSelectedThreadId}
              />
              <div className="space-y-1">
                <SidebarGroupLabel className="px-2 text-xs font-medium text-sidebar-foreground/50">
                  Spaces
                </SidebarGroupLabel>
                {spacesError ? (
                  <p className="px-2 py-1 text-xs text-destructive">
                    {spacesError.message}
                  </p>
                ) : spacesFetching && spaces.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-sidebar-foreground/55">
                    Loading Spaces...
                  </p>
                ) : contextualSpaces.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-sidebar-foreground/55">
                    No Spaces yet
                  </p>
                ) : (
                  contextualSpaces.map((space) => (
                    <SpaceThreadSection
                      key={space.id}
                      space={space}
                      threads={spaceThreadsById.get(space.id) ?? []}
                      selectedThreadId={selectedThreadId}
                      activeSpaceId={routeSpaceId}
                      onActivate={setSelectedThreadId}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </SidebarGroup>
      </div>

      <ThreadSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        search={search}
        onSearchChange={setSearch}
        threads={searchThreads}
        isLoading={searchFetching && !searchData}
        error={searchError?.message ?? null}
      />
    </div>
  );
}

function ThreadSearchDialog({
  open,
  onOpenChange,
  search,
  onSearchChange,
  threads,
  isLoading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  threads: ChatThreadSummary[];
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search threads</DialogTitle>
        <div className="border-b p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="h-10 border-0 bg-transparent pl-9 text-base shadow-none focus-visible:ring-0"
              placeholder="Search threads"
              aria-label="Search threads"
            />
          </label>
        </div>
        <div className="scrollbar-auto-hide max-h-[420px] overflow-y-auto p-2">
          {error ? (
            <p className="px-2 py-3 text-sm text-destructive">{error}</p>
          ) : isLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              Searching...
            </p>
          ) : threads.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No threads found
            </p>
          ) : (
            <div className="space-y-0.5">
              {threads.map((thread) => (
                <Link
                  key={thread.id}
                  to="/threads/$id"
                  params={{ id: thread.id }}
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => onOpenChange(false)}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      isThreadUnread(thread) ? "bg-blue-500" : "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {threadTitle(thread)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadListSection({
  label,
  threads,
  selectedThreadId,
  defaultOpen = true,
  emptyBehavior,
  onActivate,
}: {
  label: string;
  threads: ChatThreadSummary[];
  selectedThreadId?: string;
  defaultOpen?: boolean;
  emptyBehavior: "hidden" | "message";
  onActivate: (threadId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (threads.length === 0 && emptyBehavior === "hidden") return null;
  const visibleThreads = showAll
    ? threads
    : threads.slice(0, SECTION_THREAD_LIMIT);
  const hiddenCount = threads.length - visibleThreads.length;

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/thread-section">
      <CollapsibleTrigger asChild>
        <SidebarGroupLabel
          asChild
          className="cursor-pointer select-none px-2 text-xs font-medium text-sidebar-foreground/50 data-[state=open]:text-sidebar-foreground/70"
        >
          <button type="button" aria-label={`Toggle ${label}`}>
            <span>{label}</span>
            <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=closed]/thread-section:-rotate-90" />
          </button>
        </SidebarGroupLabel>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarGroupContent>
          {threads.length === 0 ? (
            <p className="px-2 py-1 text-xs text-sidebar-foreground/55">
              No threads yet
            </p>
          ) : (
            <div className="space-y-0.5">
              {visibleThreads.map((thread) => (
                <ChatThreadRow
                  key={thread.id}
                  thread={thread}
                  active={selectedThreadId === thread.id}
                  onActivate={() => onActivate(thread.id)}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="px-2 pt-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                  onClick={() => setShowAll(true)}
                >
                  Show more ({hiddenCount})
                </button>
              ) : null}
            </div>
          )}
        </SidebarGroupContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SpaceThreadSection({
  space,
  threads,
  selectedThreadId,
  activeSpaceId,
  onActivate,
}: {
  space: SpaceNavSummary;
  threads: ChatThreadSummary[];
  selectedThreadId?: string;
  activeSpaceId?: string;
  onActivate: (threadId: string) => void;
}) {
  const label = space.name ?? space.slug ?? "Space";
  const isActiveSpace = activeSpaceId === space.id;
  const [showAll, setShowAll] = useState(false);
  const visibleThreads = showAll
    ? threads
    : threads.slice(0, SECTION_THREAD_LIMIT);
  const hiddenCount = threads.length - visibleThreads.length;

  return (
    <Collapsible
      defaultOpen={isActiveSpace || threads.length > 0}
      className="group/space"
    >
      <CollapsibleTrigger asChild>
        <SidebarGroupLabel
          asChild
          className={cn(
            "cursor-pointer select-none px-2 text-xs font-medium text-sidebar-foreground/60 data-[state=open]:text-sidebar-foreground/80",
            isActiveSpace && "text-sidebar-foreground",
          )}
        >
          <button type="button" aria-label={`Toggle ${label}`}>
            <Folder className="mr-2 h-4 w-4 shrink-0 group-data-[state=open]/space:hidden" />
            <FolderOpen className="mr-2 hidden h-4 w-4 shrink-0 group-data-[state=open]/space:block" />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {space.unreadThreadCount ? (
              <span className="mr-1 rounded-full bg-sidebar-accent px-1.5 text-[10px] text-sidebar-accent-foreground">
                {space.unreadThreadCount}
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]/space:-rotate-90" />
          </button>
        </SidebarGroupLabel>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarGroupContent>
          {threads.length === 0 ? (
            <Link
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              className={cn(
                "ml-5 flex h-8 min-w-0 items-center rounded-md px-2 text-sm text-sidebar-foreground/55 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActiveSpace &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <span className="truncate">{label}</span>
            </Link>
          ) : (
            <div className="ml-5 space-y-0.5">
              {visibleThreads.map((thread) => (
                <ChatThreadRow
                  key={thread.id}
                  thread={thread}
                  active={selectedThreadId === thread.id}
                  spaceRouteId={space.id}
                  onActivate={() => onActivate(thread.id)}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="px-2 pt-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                  onClick={() => setShowAll(true)}
                >
                  Show more ({hiddenCount})
                </button>
              ) : null}
            </div>
          )}
        </SidebarGroupContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SettingsNav({ onBack }: { onBack: () => void }) {
  const items = [
    { label: "General", icon: Settings, active: true },
    { label: "Appearance", icon: Sun },
    { label: "Configuration", icon: Shield },
    { label: "Personalization", icon: User },
    { label: "Keyboard shortcuts", icon: Keyboard },
    { label: "MCP servers", icon: Paperclip },
    { label: "Hooks", icon: Anchor },
    { label: "Connections", icon: Globe },
    { label: "Git", icon: GitBranch },
    { label: "Environments", icon: Monitor },
    { label: "Worktrees", icon: SlidersHorizontal },
    { label: "Browser", icon: Monitor },
    { label: "Computer use", icon: SlidersHorizontal },
    { label: "Archived chats", icon: Archive },
  ];

  return (
    <div className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto px-3 pb-3 group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        className="mb-3 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/65 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" />
        <span>Back to app</span>
      </button>
      <nav className="space-y-1" aria-label="Settings">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={cn(
              navItemClassName,
              item.active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ChatThreadRow({
  thread,
  active,
  spaceRouteId,
  onActivate,
}: {
  thread: ChatThreadSummary;
  active: boolean;
  spaceRouteId?: string;
  onActivate: () => void;
}) {
  const unread = isThreadUnread(thread);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [{ fetching: deleting }, deleteThread] =
    useMutation(DeleteThreadMutation);
  const activity = threadActivityAt(thread);
  const relativeDate = formatTinyRelativeDate(activity);
  const title = threadTitle(thread);
  const linkProps = spaceRouteId
    ? ({
        to: "/spaces/$spaceId/threads/$threadId",
        params: { spaceId: spaceRouteId, threadId: thread.id },
      } as const)
    : ({ to: "/threads/$id", params: { id: thread.id } } as const);

  async function handleConfirmDelete() {
    setThreadDeletePending(thread.id, true);
    try {
      const result = await deleteThread({ id: thread.id });
      if (result.error) {
        setThreadDeletePending(thread.id, false);
        toast.error(`Could not delete thread: ${result.error.message}`);
        return;
      }

      toast.success("Thread deleted.");
      window.dispatchEvent(
        new CustomEvent("thinkwork:thread-deleted", {
          detail: { threadId: thread.id },
        }),
      );
    } catch (err) {
      setThreadDeletePending(thread.id, false);
      toast.error(
        `Could not delete thread: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setConfirmingDelete(false);
    }
  }

  return (
    <div
      className={cn(
        "group/thread-row relative flex h-8 min-w-0 items-center rounded-md outline-none transition-colors hover:bg-sidebar-accent",
        active && "bg-sidebar-accent",
      )}
    >
      <Link
        {...linkProps}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 pr-14 text-sidebar-foreground/70 outline-none transition-colors hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        onClick={onActivate}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            unread ? "bg-blue-500" : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      </Link>
      {confirmingDelete ? (
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-60"
          disabled={deleting}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleConfirmDelete();
          }}
        >
          Confirm
        </button>
      ) : (
        <>
          {relativeDate ? (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums text-sidebar-foreground/45 group-hover/thread-row:hidden"
              title={activity ?? undefined}
            >
              {relativeDate}
            </span>
          ) : null}
          <button
            type="button"
            className="absolute right-1 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground/70 group-hover/thread-row:flex"
            aria-label={`Delete ${title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setConfirmingDelete(true);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

const navItemClassName =
  "flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm font-normal text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function threadIdFromThreadPath(pathname: string) {
  const canonicalMatch = /^\/threads\/([^/]+)$/.exec(pathname);
  if (canonicalMatch) return decodeURIComponent(canonicalMatch[1]);
  const spaceMatch = /^\/spaces\/[^/]+\/threads\/([^/]+)$/.exec(pathname);
  return spaceMatch ? decodeURIComponent(spaceMatch[1]) : undefined;
}

function spaceIdFromThreadPath(pathname: string) {
  const match = /^\/spaces\/([^/]+)\/threads\/[^/]+/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isDefaultSpace(space: SpaceNavSummary) {
  const slug = space.slug?.toLowerCase();
  const name = space.name?.toLowerCase();
  return (
    slug === "default" ||
    slug === "general" ||
    name === "default" ||
    name === "general"
  );
}

interface ThreadSelectedDetail {
  threadId?: string | null;
}

interface ThreadDeletedDetail {
  threadId?: string | null;
}
