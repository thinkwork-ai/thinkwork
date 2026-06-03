import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { IconPin } from "@tabler/icons-react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useSubscription } from "urql";
import { toast } from "sonner";
import {
  Anchor,
  Archive,
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  Clock,
  GitBranch,
  Globe,
  Keyboard,
  List,
  ListFilter,
  MessageCirclePlus,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  SquarePen,
  Sun,
  Table2,
  Trash2,
  User,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@thinkwork/ui";
import { isDefaultSpace } from "@/components/spaces/space-utils";
import { useTenant } from "@/context/TenantContext";
import { useThreadNotifications } from "@/hooks/useThreadNotifications";
import { useThreadNotificationsEnabled } from "@/lib/thread-notifications-pref";
import {
  DeleteThreadMutation,
  MarkThreadsReadMutation,
  PinThreadMutation,
  PinnedThreadsQuery,
  ReorderPinnedThreadsMutation,
  SpaceThreadsQuery,
  SpacesQuery,
  ThreadsPagedQuery,
  ThreadUpdatedSubscription,
  UnpinThreadMutation,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import {
  setSectionUnreadFilter,
  useSectionUnreadFilter,
} from "@/lib/sidebar-section-prefs";
import { requestSpacesComposerFocus } from "@/lib/composer-focus";
import {
  clearMissingThreadDeletes,
  setThreadDeletePending,
  usePendingThreadDeletes,
} from "@/lib/pending-thread-deletes";
import { cn } from "@/lib/utils";
import {
  displayedUnreadThreads,
  filterUnreadThreads,
  formatCompactCount,
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

interface PinnedThreadsResult {
  pinnedThreads?: Array<{
    pinnedAt?: string | null;
    pinOrder?: number | null;
    thread?: ChatThreadSummary | null;
  }> | null;
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
const PINNED_LIMIT = 100;
const SECTION_THREAD_LIMIT = 5;
// Each space section fetches its OWN recent window (matching the space detail
// page) instead of bucketing the tenant-wide RECENT_LIMIT list, which starved
// busy-tenant spaces. 40 mirrors the detail page's limit.
const SPACE_SECTION_FETCH_LIMIT = 40;

export function ChatSidebar() {
  const { tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const routeSpaceId = spaceIdFromThreadPath(location.pathname);
  const routeThreadId = threadIdFromThreadPath(location.pathname);
  // Desktop OS notifications for thread activity (no-op in the web build).
  const threadNotificationsEnabled = useThreadNotificationsEnabled();
  useThreadNotifications({
    activeThreadId: routeThreadId ?? null,
    enabled: threadNotificationsEnabled,
  });
  const isNewThreadRoute = location.pathname === "/new";
  const isAutomationsRoute = location.pathname === "/automations";
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(
    routeThreadId,
  );
  const [locallyReadThreadIds, setLocallyReadThreadIds] = useState<Set<string>>(
    () => new Set(routeThreadId ? [routeThreadId] : []),
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pendingThreadDeletes = usePendingThreadDeletes();
  const recentThreadOrderRef = useRef<ChatThreadSummary[]>([]);
  const pendingThreadDeletesRef = useRef(pendingThreadDeletes);
  const persistedReadThreadIdsRef = useRef(new Set<string>());
  const pinMigrationInFlightRef = useRef<string | null>(null);
  const [, updateThread] = useMutation(UpdateThreadMutation);
  const [, executePinThread] = useMutation(PinThreadMutation);
  const [, executeUnpinThread] = useMutation(UnpinThreadMutation);
  const [, executeReorderPinnedThreads] = useMutation(
    ReorderPinnedThreadsMutation,
  );
  const [, executeMarkThreadsRead] = useMutation(MarkThreadsReadMutation);
  const pinStorageKey = useMemo(
    () => threadPinsStorageKey(tenantId, userId),
    [tenantId, userId],
  );
  const pinMigrationStorageKey = useMemo(
    () => threadPinsMigrationStorageKey(tenantId, userId),
    [tenantId, userId],
  );
  const [optimisticPinnedOrder, setOptimisticPinnedOrder] = useState<
    string[] | null
  >(null);

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

  const [
    { data: spacesData, fetching: spacesFetching, error: spacesError },
    reexecuteSpacesQuery,
  ] = useQuery<SpacesResult>({
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
  // The generic "Chats" section lists default-space threads, so its Thread list
  // scopes to that space rather than every thread in the tenant.
  const defaultSpaceId = useMemo(
    () => selectChatsComposeSpaceId(spaces),
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
    { data: pinnedData, fetching: pinnedFetching, error: pinnedError },
    reexecutePinnedThreadsQuery,
  ] = useQuery<PinnedThreadsResult>({
    query: PinnedThreadsQuery,
    variables: {
      tenantId: tenantId ?? "",
      limit: PINNED_LIMIT,
    },
    pause: !tenantId || !userId,
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

  const persistThreadRead = useCallback(
    (threadId: string) => {
      if (persistedReadThreadIdsRef.current.has(threadId)) return;
      persistedReadThreadIdsRef.current.add(threadId);
      void updateThread({
        id: threadId,
        input: { lastReadAt: new Date().toISOString() },
      }).then((result) => {
        if (result.error) {
          persistedReadThreadIdsRef.current.delete(threadId);
          console.warn(
            `[ChatSidebar] failed to mark thread ${threadId} read:`,
            result.error,
          );
        }
      });
    },
    [updateThread],
  );

  const markThreadRead = useCallback((threadId: string) => {
    setLocallyReadThreadIds((current) => {
      if (current.has(threadId)) return current;
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
  }, []);

  // "Mark all as read" for a section: optimistically clear the badge/dots for
  // the section's unread ids, fire the batch mutation, then refetch all three
  // list sources to reconcile (recent + pinned + Spaces — the Space badge reads
  // the server unreadThreadCount, so SpacesQuery must re-run or the badge holds
  // its optimistic value).
  const markSectionThreadsRead = useCallback(
    (threadIds: string[]) => {
      if (threadIds.length === 0) return;
      setLocallyReadThreadIds((current) => {
        const next = new Set(current);
        for (const id of threadIds) next.add(id);
        return next;
      });
      void executeMarkThreadsRead({
        input: { threadIds, read: true },
      }).then((result) => {
        if (result.error) {
          setLocallyReadThreadIds((current) => {
            const next = new Set(current);
            for (const id of threadIds) {
              // Keep any id a concurrent thread-open already persisted as read
              // (activateThread → persistThreadRead seeds persistedReadThreadIdsRef),
              // so a failed mark-all can't strip a thread the user just opened.
              if (!persistedReadThreadIdsRef.current.has(id)) next.delete(id);
            }
            return next;
          });
          toast.error(`Couldn't mark all as read: ${result.error.message}`);
          return;
        }
        // These threads are read server-side now; record them so a later open
        // doesn't fire a redundant per-thread updateThread.
        for (const id of threadIds) persistedReadThreadIdsRef.current.add(id);
        reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
        reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
        reexecuteSpacesQuery({ requestPolicy: "network-only" });
      });
    },
    [
      executeMarkThreadsRead,
      reexecutePinnedThreadsQuery,
      reexecuteRecentThreadsQuery,
      reexecuteSpacesQuery,
    ],
  );

  useEffect(() => {
    if (routeThreadId) {
      setSelectedThreadId(routeThreadId);
      markThreadRead(routeThreadId);
      persistThreadRead(routeThreadId);
    } else if (location.pathname === "/new") {
      setSelectedThreadId(undefined);
    }
  }, [location.pathname, markThreadRead, persistThreadRead, routeThreadId]);

  const activateThread = useCallback(
    (threadId: string) => {
      setSelectedThreadId(threadId);
      markThreadRead(threadId);
      persistThreadRead(threadId);
    },
    [markThreadRead, persistThreadRead],
  );

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
      reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
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
      activateThread(detail.threadId);
    }

    function handleThreadRenamed() {
      reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
      reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
      reexecuteSearchThreadsQuery({ requestPolicy: "network-only" });
    }

    window.addEventListener("thinkwork:thread-deleted", handleThreadDeleted);
    window.addEventListener("thinkwork:thread-selected", handleThreadSelected);
    window.addEventListener("thinkwork:thread-renamed", handleThreadRenamed);
    return () => {
      window.removeEventListener(
        "thinkwork:thread-deleted",
        handleThreadDeleted,
      );
      window.removeEventListener(
        "thinkwork:thread-selected",
        handleThreadSelected,
      );
      window.removeEventListener(
        "thinkwork:thread-renamed",
        handleThreadRenamed,
      );
    };
  }, [
    activateThread,
    navigate,
    reexecutePinnedThreadsQuery,
    reexecuteRecentThreadsQuery,
    reexecuteSearchThreadsQuery,
  ]);

  // U1/U2: a thread the caller was @mentioned into won't appear in the list
  // until the list query re-executes — the urql document cache doesn't
  // auto-invalidate on a live event. Both a window-focus return and an
  // onThreadUpdated event trigger a coalesced network-only refetch.
  const refreshThreadLists = useCallback(() => {
    reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
    reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
    reexecuteSearchThreadsQuery({ requestPolicy: "network-only" });
  }, [
    reexecutePinnedThreadsQuery,
    reexecuteRecentThreadsQuery,
    reexecuteSearchThreadsQuery,
  ]);

  const threadListRefreshTimerRef = useRef<number | null>(null);
  const scheduleThreadListRefresh = useCallback(() => {
    // Coalesce bursts of events into a single trailing refetch.
    if (threadListRefreshTimerRef.current != null) return;
    threadListRefreshTimerRef.current = window.setTimeout(() => {
      threadListRefreshTimerRef.current = null;
      refreshThreadLists();
    }, 400);
  }, [refreshThreadLists]);

  useEffect(
    () => () => {
      if (threadListRefreshTimerRef.current != null) {
        window.clearTimeout(threadListRefreshTimerRef.current);
      }
    },
    [],
  );

  // U1: returning to the window (focus / tab visible) re-runs the list query so
  // threads created/tagged while the desktop app was backgrounded show up.
  useEffect(() => {
    function handleWindowActive() {
      if (document.visibilityState === "visible") scheduleThreadListRefresh();
    }
    window.addEventListener("focus", handleWindowActive);
    document.addEventListener("visibilitychange", handleWindowActive);
    return () => {
      window.removeEventListener("focus", handleWindowActive);
      document.removeEventListener("visibilitychange", handleWindowActive);
    };
  }, [scheduleThreadListRefresh]);

  // U2: onThreadUpdated is tenant-scoped and fires for the caller on both
  // createThread and sendMessage, so a thread the caller was just added to
  // pushes an event even though they don't yet know its id. Refetch the list
  // when one arrives so tagged threads appear without a manual refresh.
  const [{ data: threadUpdatedEvent }] = useSubscription<{
    onThreadUpdated?: { threadId?: string | null } | null;
  }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  useEffect(() => {
    if (!threadUpdatedEvent?.onThreadUpdated) return;
    scheduleThreadListRefresh();
  }, [threadUpdatedEvent, scheduleThreadListRefresh]);

  const recentThreads = useMemo(
    () =>
      orderedRecentThreads.filter(
        (thread) => !pendingThreadDeletes.has(thread.id),
      ),
    [orderedRecentThreads, pendingThreadDeletes],
  );
  const serverPinnedThreads = useMemo(
    () =>
      (pinnedData?.pinnedThreads ?? [])
        .map((entry) => entry.thread)
        .filter((thread): thread is ChatThreadSummary => Boolean(thread))
        .filter((thread) => !pendingThreadDeletes.has(thread.id)),
    [pendingThreadDeletes, pinnedData?.pinnedThreads],
  );
  const pinnedThreads = useMemo(
    () => orderPinnedThreads(serverPinnedThreads, optimisticPinnedOrder),
    [optimisticPinnedOrder, serverPinnedThreads],
  );
  const pinnedThreadIds = useMemo(
    () => pinnedThreads.map((thread) => thread.id),
    [pinnedThreads],
  );
  const pinnedThreadIdSet = useMemo(
    () => new Set(pinnedThreadIds),
    [pinnedThreadIds],
  );
  const unpinnedRecentThreads = useMemo(
    () => recentThreads.filter((thread) => !pinnedThreadIdSet.has(thread.id)),
    [pinnedThreadIdSet, recentThreads],
  );
  const genericThreads = useMemo(
    () =>
      unpinnedRecentThreads.filter(
        (thread) => !thread.spaceId || defaultSpaceIds.has(thread.spaceId),
      ),
    [defaultSpaceIds, unpinnedRecentThreads],
  );
  const spaceThreadsById = useMemo(() => {
    const grouped = new Map<string, ChatThreadSummary[]>();
    for (const thread of unpinnedRecentThreads) {
      if (!thread.spaceId || defaultSpaceIds.has(thread.spaceId)) continue;
      const list = grouped.get(thread.spaceId) ?? [];
      list.push(thread);
      grouped.set(thread.spaceId, list);
    }
    return grouped;
  }, [defaultSpaceIds, unpinnedRecentThreads]);
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

  useEffect(() => {
    setOptimisticPinnedOrder(null);
  }, [pinnedData?.pinnedThreads]);

  const openSearchThread = useCallback(
    (thread: ChatThreadSummary) => {
      activateThread(thread.id);
      setSearchOpen(false);

      if (thread.spaceId && !defaultSpaceIds.has(thread.spaceId)) {
        void navigate({
          to: "/spaces/$spaceId/threads/$threadId",
          params: { spaceId: thread.spaceId, threadId: thread.id },
        });
        return;
      }

      void navigate({
        to: "/threads/$id",
        params: { id: thread.id },
      });
    },
    [activateThread, defaultSpaceIds, navigate],
  );

  const refreshThreadPins = useCallback(() => {
    reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
    reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
    reexecuteSearchThreadsQuery({ requestPolicy: "network-only" });
  }, [
    reexecutePinnedThreadsQuery,
    reexecuteRecentThreadsQuery,
    reexecuteSearchThreadsQuery,
  ]);

  const pinThread = useCallback(
    (threadId: string) => {
      if (!tenantId || !userId) return;
      void executePinThread({ tenantId, threadId }).then((result) => {
        if (result.error) {
          toast.error(result.error.message);
          return;
        }
        refreshThreadPins();
      });
    },
    [executePinThread, refreshThreadPins, tenantId, userId],
  );

  const unpinThread = useCallback(
    (threadId: string) => {
      if (!tenantId || !userId) return;
      void executeUnpinThread({ tenantId, threadId }).then((result) => {
        if (result.error) {
          toast.error(result.error.message);
          return;
        }
        refreshThreadPins();
      });
    },
    [executeUnpinThread, refreshThreadPins, tenantId, userId],
  );

  const reorderPinnedThreads = useCallback(
    (orderedVisibleIds: string[]) => {
      if (!tenantId || !userId) return;
      setOptimisticPinnedOrder(orderedVisibleIds);
      void executeReorderPinnedThreads({
        tenantId,
        threadIds: orderedVisibleIds,
      }).then((result) => {
        if (result.error) {
          setOptimisticPinnedOrder(null);
          toast.error(result.error.message);
          refreshThreadPins();
          return;
        }
        refreshThreadPins();
      });
    },
    [executeReorderPinnedThreads, refreshThreadPins, tenantId, userId],
  );

  useEffect(() => {
    if (!tenantId || !userId || !pinnedData || pinnedFetching) return;
    if (readPinMigrationCompleted(pinMigrationStorageKey)) return;
    if (pinMigrationInFlightRef.current === pinMigrationStorageKey) return;

    const localPinnedIds = readPinnedThreadIds(pinStorageKey);
    const serverPinnedIds = new Set(
      serverPinnedThreads.map((thread) => thread.id),
    );
    const missingIds = localPinnedIds.filter(
      (threadId) => !serverPinnedIds.has(threadId),
    );

    if (missingIds.length === 0) {
      writePinMigrationCompleted(pinMigrationStorageKey);
      return;
    }

    pinMigrationInFlightRef.current = pinMigrationStorageKey;
    void (async () => {
      for (const threadId of missingIds) {
        const result = await executePinThread({ tenantId, threadId });
        if (result.error) {
          throw result.error;
        }
      }
      writePinMigrationCompleted(pinMigrationStorageKey);
      refreshThreadPins();
    })()
      .catch((error) => {
        console.warn(
          "[ChatSidebar] failed to migrate local pinned threads:",
          error,
        );
      })
      .finally(() => {
        pinMigrationInFlightRef.current = null;
      });
  }, [
    executePinThread,
    pinMigrationStorageKey,
    pinStorageKey,
    pinnedData,
    pinnedFetching,
    refreshThreadPins,
    serverPinnedThreads,
    tenantId,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarGroup className="shrink-0 pt-0 pb-2 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5" aria-label="Chat actions">
            <SidebarMenuItem>
              <div className="relative" data-new-thread-row>
                <SidebarMenuButton
                  asChild
                  isActive={isNewThreadRoute}
                  tooltip="New thread"
                >
                  <Link
                    to="/new"
                    search={{ spaceId: undefined }}
                    onClick={requestSpacesComposerFocus}
                  >
                    <MessageCirclePlus />
                    <span>New thread</span>
                  </Link>
                </SidebarMenuButton>
                <SpaceJumpMenu spaces={spaces} isLoading={spacesFetching} />
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Search">
                <button type="button" onClick={() => setSearchOpen(true)}>
                  <Search />
                  <span className="min-w-0 flex-1 text-left">Search</span>
                  <span className="ml-auto text-xs text-sidebar-foreground/45">
                    ⌘K
                  </span>
                </button>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isAutomationsRoute}
                tooltip="Automations"
              >
                <Link to="/automations">
                  <Clock />
                  <span>Automations</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
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
            pinnedThreads.length === 0 &&
            contextualSpaces.length === 0 &&
            !spacesFetching ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
              No threads yet
            </p>
          ) : (
            <div className="space-y-3">
              {pinnedError ? (
                <p className="px-2 py-1 text-xs text-destructive">
                  {pinnedError.message}
                </p>
              ) : null}
              <PinnedThreadListSection
                threads={pinnedThreads}
                selectedThreadId={selectedThreadId}
                locallyReadThreadIds={locallyReadThreadIds}
                onActivate={activateThread}
                onUnpin={unpinThread}
                onReorder={reorderPinnedThreads}
              />
              <ThreadListSection
                label="Chats"
                sectionId="chats"
                threads={genericThreads}
                selectedThreadId={selectedThreadId}
                defaultOpen
                locallyReadThreadIds={locallyReadThreadIds}
                scopeSpaceId={defaultSpaceId}
                scopeSpaceName="Chats"
                onActivate={activateThread}
                onPin={pinThread}
                onMarkSectionRead={markSectionThreadsRead}
              />
              <div className="space-y-1">
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
                      seedThreads={spaceThreadsById.get(space.id) ?? []}
                      tenantId={tenantId}
                      pinnedThreadIdSet={pinnedThreadIdSet}
                      pendingThreadDeletes={pendingThreadDeletes}
                      selectedThreadId={selectedThreadId}
                      activeSpaceId={routeSpaceId}
                      locallyReadThreadIds={locallyReadThreadIds}
                      onActivate={activateThread}
                      onPin={pinThread}
                      onMarkSectionRead={markSectionThreadsRead}
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
        pinnedThreadIds={pinnedThreadIdSet}
        defaultSpaceIds={defaultSpaceIds}
        locallyReadThreadIds={locallyReadThreadIds}
        onSelectThread={openSearchThread}
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
  pinnedThreadIds,
  defaultSpaceIds,
  locallyReadThreadIds,
  onSelectThread,
  isLoading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  threads: ChatThreadSummary[];
  pinnedThreadIds: ReadonlySet<string>;
  defaultSpaceIds: ReadonlySet<string>;
  locallyReadThreadIds: ReadonlySet<string>;
  onSelectThread: (thread: ChatThreadSummary) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const groups = useMemo(
    () => groupSearchThreads(threads, pinnedThreadIds, defaultSpaceIds),
    [defaultSpaceIds, pinnedThreadIds, threads],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search threads"
      description="Search across threads and Spaces"
      className="sm:max-w-2xl"
      showCloseButton
    >
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search threads"
          aria-label="Search threads"
        />
        <CommandList className="scrollbar-auto-hide max-h-[420px]">
          {error ? (
            <CommandEmpty className="text-destructive">{error}</CommandEmpty>
          ) : isLoading ? (
            <CommandEmpty>Searching...</CommandEmpty>
          ) : (
            <CommandEmpty>No threads found</CommandEmpty>
          )}
          {!error && !isLoading
            ? groups.map((group) => (
                <CommandGroup key={group.key} heading={group.label}>
                  {group.threads.map((thread) => {
                    const relativeDate = formatTinyRelativeDate(
                      threadActivityAt(thread),
                    );

                    return (
                      <CommandItem
                        key={thread.id}
                        value={[
                          group.label,
                          threadTitle(thread),
                          thread.identifier,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        className="h-10"
                        onSelect={() => onSelectThread(thread)}
                      >
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            isThreadUnread(thread) &&
                              !locallyReadThreadIds.has(thread.id)
                              ? "bg-blue-500"
                              : "bg-transparent",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {threadTitle(thread)}
                        </span>
                        {relativeDate ? (
                          <CommandShortcut className="tracking-normal">
                            {relativeDate}
                          </CommandShortcut>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))
            : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function groupSearchThreads(
  threads: ChatThreadSummary[],
  pinnedThreadIds: ReadonlySet<string>,
  defaultSpaceIds: ReadonlySet<string>,
) {
  const groups = new Map<
    string,
    { key: string; label: string; threads: ChatThreadSummary[] }
  >();

  for (const thread of threads) {
    const group = pinnedThreadIds.has(thread.id)
      ? { key: "pinned", label: "Pinned" }
      : thread.spaceId && !defaultSpaceIds.has(thread.spaceId)
        ? {
            key: `space:${thread.spaceId}`,
            label:
              thread.space?.name ??
              thread.space?.slug ??
              thread.spaceId ??
              "Space",
          }
        : { key: "chats", label: "Chats" };

    const existing = groups.get(group.key);
    if (existing) {
      existing.threads.push(thread);
    } else {
      groups.set(group.key, { ...group, threads: [thread] });
    }
  }

  return Array.from(groups.values());
}

function selectChatsComposeSpaceId(spaces: SpaceNavSummary[]) {
  return (
    spaces.find((space) => hasSpaceMarker(space, "default"))?.id ??
    spaces.find(isDefaultSpace)?.id
  );
}

function hasSpaceMarker(space: SpaceNavSummary, marker: string) {
  const normalizedMarker = marker.toLowerCase();
  return (
    space.slug?.toLowerCase() === normalizedMarker ||
    space.name?.toLowerCase() === normalizedMarker
  );
}

function orderPinnedThreads(
  threads: ChatThreadSummary[],
  optimisticOrder: readonly string[] | null,
) {
  if (!optimisticOrder || optimisticOrder.length === 0) return threads;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ordered = optimisticOrder
    .map((threadId) => byId.get(threadId))
    .filter((thread): thread is ChatThreadSummary => Boolean(thread));
  const orderedIds = new Set(ordered.map((thread) => thread.id));
  return [
    ...ordered,
    ...threads.filter((thread) => !orderedIds.has(thread.id)),
  ];
}

/** Unread-count chip, rendered immediately after a section's label. */
function SectionUnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-sidebar-accent px-1.5 text-[10px] leading-5 text-sidebar-accent-foreground">
      {formatCompactCount(count)}
    </span>
  );
}

/**
 * Trailing controls for a thread-grouped section header: a filtered indicator
 * and a hover/focus-revealed "…" menu (Mark all as read; Show unread / Show
 * all). Rendered as a SIBLING of the collapse trigger so opening the menu never
 * toggles the section (R2). The unread badge sits next to the label, not here.
 */
function SectionHeaderControls({
  sectionId,
  label,
  unreadThreadIds,
  filterOn,
  scopeSpaceId,
  scopeSpaceName,
  onMarkSectionRead,
}: {
  sectionId: string;
  label: string;
  unreadThreadIds: string[];
  filterOn: boolean;
  // The space the section's "Thread list" opens scoped to. For a Space section
  // it's that space; for the generic "Chats" section it's the default space, so
  // the table matches what the section actually lists (not every thread).
  scopeSpaceId?: string;
  scopeSpaceName?: string;
  onMarkSectionRead?: (threadIds: string[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  return (
    // Filter indicator and "…" menu share one slot: the filter icon shows when
    // the section is filtered and idle; on hover, touch, or while the menu is
    // open it gives way to the "…" trigger so the two never stack.
    <div className="relative ml-auto size-6 shrink-0">
      {filterOn && !menuOpen ? (
        <ListFilter
          className="pointer-events-none absolute inset-0 m-auto size-3.5 text-sidebar-foreground/45 transition-opacity group-hover/section-row:opacity-0 [@media(hover:none)]:opacity-0"
          aria-label="Filtered to unread"
        />
      ) : null}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${label} options`}
            className="absolute inset-0 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 opacity-0 outline-none transition-opacity hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/section-row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-[1000] w-44"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem
            onSelect={() => setSectionUnreadFilter(sectionId, !filterOn)}
          >
            {filterOn ? (
              <List className="size-4" />
            ) : (
              <ListFilter className="size-4" />
            )}
            {filterOn ? "Show all" : "Show unread"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!onMarkSectionRead || unreadThreadIds.length === 0}
            onSelect={() => onMarkSectionRead?.(unreadThreadIds)}
          >
            <CheckCheck className="size-4" />
            Mark all as read
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              navigate({
                to: "/threads",
                search: {
                  spaceId: scopeSpaceId,
                  spaceName: scopeSpaceId ? scopeSpaceName : undefined,
                },
              })
            }
          >
            <Table2 className="size-4" />
            Thread list
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ThreadListSection({
  label,
  sectionId,
  threads,
  selectedThreadId,
  defaultOpen = true,
  locallyReadThreadIds,
  scopeSpaceId,
  scopeSpaceName,
  onActivate,
  onPin,
  onMarkSectionRead,
}: {
  label: string;
  sectionId: string;
  threads: ChatThreadSummary[];
  selectedThreadId?: string;
  defaultOpen?: boolean;
  locallyReadThreadIds: ReadonlySet<string>;
  scopeSpaceId?: string;
  scopeSpaceName?: string;
  onActivate: (threadId: string) => void;
  onPin?: (threadId: string) => void;
  onMarkSectionRead?: (threadIds: string[]) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(SECTION_THREAD_LIMIT);
  const filterOn = useSectionUnreadFilter(sectionId);
  // Reset pagination when the filter mode flips, so a "Show more" count from one
  // mode can't truncate the other's list.
  useEffect(() => {
    setVisibleCount(SECTION_THREAD_LIMIT);
  }, [filterOn]);

  // Unread set drives the badge, the mark-all target, and the filter — one
  // source so the badge reaches zero after a mark-all (KTD-2).
  const unreadThreads = filterUnreadThreads(threads, locallyReadThreadIds);
  const unreadThreadIds = unreadThreads.map((thread) => thread.id);
  // The displayed list additionally retains the selected thread so opening one
  // while filtered doesn't make it vanish (it stays until selection moves).
  const displayedThreads = filterOn
    ? displayedUnreadThreads(threads, locallyReadThreadIds, selectedThreadId)
    : threads;
  const visibleThreads = displayedThreads.slice(0, visibleCount);
  const hiddenCount = displayedThreads.length - visibleThreads.length;

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/thread-section">
      <div className="group/section-row flex w-full items-center gap-0">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            asChild
            className="group/section-trigger min-w-0 flex-1 cursor-pointer select-none gap-1.5 px-2 text-xs font-medium text-sidebar-foreground/50"
          >
            <button type="button" aria-label={`Toggle ${label}`}>
              <span className="min-w-0 truncate text-left">{label}</span>
              <SectionUnreadBadge count={unreadThreadIds.length} />
              <ChevronDown className="h-4 w-4 shrink-0 opacity-0 transition-all duration-150 ease-out group-hover/section-trigger:opacity-100 group-data-[state=closed]/thread-section:-rotate-90" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <Link
          to="/new"
          search={{ spaceId: scopeSpaceId }}
          onClick={requestSpacesComposerFocus}
          aria-label={`New thread in ${label}`}
          title="New thread"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/45 opacity-0 outline-none transition-opacity hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/section-row:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <SquarePen className="size-3.5" />
        </Link>
        <SectionHeaderControls
          sectionId={sectionId}
          label={label}
          unreadThreadIds={unreadThreadIds}
          filterOn={filterOn}
          scopeSpaceId={scopeSpaceId}
          scopeSpaceName={scopeSpaceName}
          onMarkSectionRead={onMarkSectionRead}
        />
      </div>
      <CollapsibleContent>
        <SidebarGroupContent>
          {threads.length === 0 ? (
            <p className="px-2 py-1 text-xs text-sidebar-foreground/55">
              No threads yet
            </p>
          ) : filterOn && displayedThreads.length === 0 ? (
            <button
              type="button"
              className="px-2 py-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
              onClick={() => setSectionUnreadFilter(sectionId, false)}
            >
              No unread — Show all
            </button>
          ) : (
            <div className="space-y-0.5">
              {visibleThreads.map((thread) => (
                <ChatThreadRow
                  key={thread.id}
                  thread={thread}
                  active={selectedThreadId === thread.id}
                  locallyRead={locallyReadThreadIds.has(thread.id)}
                  onActivate={() => onActivate(thread.id)}
                  onPin={onPin ? () => onPin(thread.id) : undefined}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="px-2 pt-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                  onClick={() =>
                    setVisibleCount((count) =>
                      Math.min(
                        count + SECTION_THREAD_LIMIT,
                        displayedThreads.length,
                      ),
                    )
                  }
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

function PinnedThreadListSection({
  threads,
  selectedThreadId,
  locallyReadThreadIds,
  onActivate,
  onUnpin,
  onReorder,
}: {
  threads: ChatThreadSummary[];
  selectedThreadId?: string;
  locallyReadThreadIds: ReadonlySet<string>;
  onActivate: (threadId: string) => void;
  onUnpin?: (threadId: string) => void;
  onReorder?: (threadIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const threadIds = useMemo(
    () => threads.map((thread) => thread.id),
    [threads],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = threadIds.indexOf(String(active.id));
      const newIndex = threadIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onReorder?.(arrayMove(threadIds, oldIndex, newIndex));
    },
    [onReorder, threadIds],
  );

  if (threads.length === 0) return null;

  return (
    <Collapsible defaultOpen className="group/thread-section">
      <CollapsibleTrigger asChild>
        <SidebarGroupLabel
          asChild
          className="group/section-trigger w-full cursor-pointer select-none gap-1.5 px-2 text-xs font-medium text-sidebar-foreground/50"
        >
          <button type="button" aria-label="Toggle Pinned">
            <span>Pinned</span>
            <ChevronDown className="h-4 w-4 opacity-0 transition-all duration-150 ease-out group-hover/section-trigger:opacity-100 group-data-[state=closed]/thread-section:-rotate-90" />
          </button>
        </SidebarGroupLabel>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarGroupContent>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={threadIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5">
                {threads.map((thread) => (
                  <SortablePinnedThreadRow
                    key={thread.id}
                    thread={thread}
                    active={selectedThreadId === thread.id}
                    locallyRead={locallyReadThreadIds.has(thread.id)}
                    onActivate={() => onActivate(thread.id)}
                    onUnpin={onUnpin ? () => onUnpin(thread.id) : undefined}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </SidebarGroupContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SortablePinnedThreadRow({
  thread,
  active,
  locallyRead,
  onActivate,
  onUnpin,
}: {
  thread: ChatThreadSummary;
  active: boolean;
  locallyRead: boolean;
  onActivate: () => void;
  onUnpin?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: thread.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-10")}
      {...listeners}
    >
      <ChatThreadRow
        thread={thread}
        active={active}
        locallyRead={locallyRead}
        pinned
        onActivate={onActivate}
        onUnpin={onUnpin}
      />
    </div>
  );
}

function SpaceJumpMenu({
  spaces,
  isLoading,
}: {
  spaces: SpaceNavSummary[];
  isLoading?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open Space menu"
          className={cn(
            "tw-new-thread-space-menu pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/45 opacity-0 transition-opacity hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="z-[1000] w-56"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>Open Space</DropdownMenuLabel>
        {isLoading && spaces.length === 0 ? (
          <DropdownMenuItem disabled>Loading Spaces...</DropdownMenuItem>
        ) : spaces.length === 0 ? (
          <DropdownMenuItem disabled>No Spaces yet</DropdownMenuItem>
        ) : (
          spaces.map((space) => (
            <DropdownMenuItem key={space.id} asChild>
              <Link
                to="/spaces/$spaceId"
                params={{ spaceId: space.id }}
                className="min-w-0"
              >
                <span className="truncate">
                  {space.name ?? space.slug ?? "Space"}
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SpaceThreadSection({
  space,
  seedThreads,
  tenantId,
  pinnedThreadIdSet,
  pendingThreadDeletes,
  selectedThreadId,
  activeSpaceId,
  locallyReadThreadIds,
  onActivate,
  onPin,
  onMarkSectionRead,
}: {
  space: SpaceNavSummary;
  seedThreads: ChatThreadSummary[];
  tenantId?: string | null;
  pinnedThreadIdSet: ReadonlySet<string>;
  pendingThreadDeletes: ReadonlySet<string>;
  selectedThreadId?: string;
  activeSpaceId?: string;
  locallyReadThreadIds: ReadonlySet<string>;
  onActivate: (threadId: string) => void;
  onPin?: (threadId: string) => void;
  onMarkSectionRead?: (threadIds: string[]) => void;
}) {
  const label = space.name ?? space.slug ?? "Space";
  const isActiveSpace = activeSpaceId === space.id;
  const sectionId = `space:${space.id}`;
  const filterOn = useSectionUnreadFilter(sectionId);

  // Fetch THIS space's own recent threads (mirrors the space detail page's
  // scoped query) rather than bucketing the tenant-wide RECENT_LIMIT window —
  // busy tenants pushed a space's threads out of that shared window, so the
  // section showed far fewer threads than the detail page listed. The bucketed
  // `seedThreads` still seed the list so a brand-new/optimistic thread appears
  // before this query refetches.
  const [{ data: scopedData }] = useQuery<ThreadsPagedResult>({
    query: SpaceThreadsQuery,
    variables: {
      tenantId: tenantId ?? "",
      spaceId: space.id,
      limit: SPACE_SECTION_FETCH_LIMIT,
      offset: 0,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const threads = useMemo(() => {
    const byId = new Map<string, ChatThreadSummary>();
    for (const thread of scopedData?.threadsPaged?.items ?? []) {
      byId.set(thread.id, thread);
    }
    for (const thread of seedThreads) {
      if (!byId.has(thread.id)) byId.set(thread.id, thread);
    }
    const merged = [...byId.values()].filter(
      (thread) =>
        !pinnedThreadIdSet.has(thread.id) &&
        !pendingThreadDeletes.has(thread.id),
    );
    return sortThreadsByActivityDesc(merged);
  }, [
    scopedData?.threadsPaged?.items,
    seedThreads,
    pinnedThreadIdSet,
    pendingThreadDeletes,
  ]);
  const [visibleCount, setVisibleCount] = useState(SECTION_THREAD_LIMIT);
  // Reset pagination when the filter mode flips (see ThreadListSection).
  useEffect(() => {
    setVisibleCount(SECTION_THREAD_LIMIT);
  }, [filterOn]);

  // Loaded unread drives the mark-all target and the filter. The BADGE keeps
  // the server's true total (`unreadThreadCount`, which may exceed the loaded
  // window) minus an optimistic decrement for loaded threads we just marked
  // read locally, so it drops on mark-all and reconciles on refetch (KTD-5).
  const unreadThreads = filterUnreadThreads(threads, locallyReadThreadIds);
  const unreadThreadIds = unreadThreads.map((thread) => thread.id);
  const optimisticallyRead = threads.filter(
    (thread) => isThreadUnread(thread) && locallyReadThreadIds.has(thread.id),
  ).length;
  const badgeCount = Math.max(
    0,
    (space.unreadThreadCount ?? 0) - optimisticallyRead,
  );
  // Retain the selected thread while filtered so opening one doesn't drop it
  // from the section the same frame it's marked read (see displayedUnreadThreads).
  const displayedThreads = filterOn
    ? displayedUnreadThreads(threads, locallyReadThreadIds, selectedThreadId)
    : threads;
  const visibleThreads = displayedThreads.slice(0, visibleCount);
  const hiddenCount = displayedThreads.length - visibleThreads.length;

  return (
    <Collapsible
      defaultOpen={isActiveSpace || threads.length > 0}
      className="group/space"
    >
      <div className="group/section-row flex w-full items-center gap-0">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            asChild
            className={cn(
              "group/space-trigger min-w-0 flex-1 cursor-pointer select-none gap-1.5 px-2 text-xs font-medium text-sidebar-foreground/50",
              isActiveSpace && "text-sidebar-foreground/70",
            )}
          >
            <button type="button" aria-label={`Toggle ${label}`}>
              <span className="min-w-0 truncate text-left">{label}</span>
              <SectionUnreadBadge count={badgeCount} />
              <ChevronDown className="h-4 w-4 shrink-0 opacity-0 transition-all duration-150 ease-out group-hover/space-trigger:opacity-100 group-data-[state=closed]/space:-rotate-90" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <Link
          to="/new"
          search={{ spaceId: space.id }}
          onClick={requestSpacesComposerFocus}
          aria-label={`New thread in ${label}`}
          title="New thread"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/45 opacity-0 outline-none transition-opacity hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/section-row:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <SquarePen className="size-3.5" />
        </Link>
        <SectionHeaderControls
          sectionId={sectionId}
          label={label}
          unreadThreadIds={unreadThreadIds}
          filterOn={filterOn}
          scopeSpaceId={space.id}
          scopeSpaceName={label}
          onMarkSectionRead={onMarkSectionRead}
        />
      </div>
      <CollapsibleContent>
        <SidebarGroupContent>
          {threads.length === 0 ? (
            <Link
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              className={cn(
                "flex h-8 min-w-0 items-center rounded-md px-2 text-sm text-sidebar-foreground/55 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActiveSpace &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <span className="truncate">{label}</span>
            </Link>
          ) : filterOn && displayedThreads.length === 0 ? (
            <button
              type="button"
              className="px-2 py-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
              onClick={() => setSectionUnreadFilter(sectionId, false)}
            >
              No unread — Show all
            </button>
          ) : (
            <div className="space-y-0.5">
              {visibleThreads.map((thread) => (
                <ChatThreadRow
                  key={thread.id}
                  thread={thread}
                  active={selectedThreadId === thread.id}
                  spaceRouteId={space.id}
                  locallyRead={locallyReadThreadIds.has(thread.id)}
                  onActivate={() => onActivate(thread.id)}
                  onPin={onPin ? () => onPin(thread.id) : undefined}
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="px-2 pt-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
                  onClick={() =>
                    setVisibleCount((count) =>
                      Math.min(
                        count + SECTION_THREAD_LIMIT,
                        displayedThreads.length,
                      ),
                    )
                  }
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

function ChatThreadRow({
  thread,
  active,
  spaceRouteId,
  locallyRead,
  onActivate,
  onPin,
  onUnpin,
  pinned = false,
}: {
  thread: ChatThreadSummary;
  active: boolean;
  spaceRouteId?: string;
  locallyRead: boolean;
  onActivate: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  pinned?: boolean;
}) {
  const unread = isThreadUnread(thread) && !locallyRead;
  const activity = threadActivityAt(thread);
  const relativeDate = formatTinyRelativeDate(activity);
  const title = threadTitle(thread);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const [renamingCommitting, setRenamingCommitting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameFocusTimerRef = useRef<number | null>(null);
  const renamingCommittingRef = useRef(false);
  const [{ fetching: deleting }, deleteThread] =
    useMutation(DeleteThreadMutation);
  const [, updateThreadTitle] = useMutation(UpdateThreadMutation);
  const linkProps = spaceRouteId
    ? ({
        to: "/spaces/$spaceId/threads/$threadId",
        params: { spaceId: spaceRouteId, threadId: thread.id },
      } as const)
    : ({ to: "/threads/$id", params: { id: thread.id } } as const);

  useEffect(() => {
    if (!renamingTitle) setRenameDraft(title);
  }, [renamingTitle, title]);

  useEffect(() => {
    if (!renamingTitle) return;
    renameFocusTimerRef.current = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      renameFocusTimerRef.current = null;
    }, 0);
    return () => {
      if (renameFocusTimerRef.current !== null) {
        window.clearTimeout(renameFocusTimerRef.current);
        renameFocusTimerRef.current = null;
      }
    };
  }, [renamingTitle]);

  const startRename = useCallback(() => {
    if (renamingCommitting) return;
    setRenameDraft(title);
    setRenamingTitle(true);
  }, [renamingCommitting, title]);

  const cancelRename = useCallback(() => {
    setRenameDraft(title);
    setRenamingTitle(false);
  }, [title]);

  const commitRename = useCallback(async () => {
    if (renamingCommittingRef.current) return;

    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      toast.error("Thread title can't be blank.");
      setRenameDraft(title);
      setRenamingTitle(false);
      return;
    }

    if (nextTitle === title.trim()) {
      setRenameDraft(title);
      setRenamingTitle(false);
      return;
    }

    renamingCommittingRef.current = true;
    setRenamingCommitting(true);
    const result = await updateThreadTitle({
      id: thread.id,
      input: { title: nextTitle },
    });
    renamingCommittingRef.current = false;
    setRenamingCommitting(false);

    if (result.error) {
      toast.error(`Could not rename thread: ${result.error.message}`);
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }

    toast.success("Thread renamed.");
    setRenamingTitle(false);
    window.dispatchEvent(
      new CustomEvent("thinkwork:thread-renamed", {
        detail: { threadId: thread.id, title: nextTitle },
      }),
    );
  }, [renameDraft, thread.id, title, updateThreadTitle]);

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
        (active || renamingTitle) && "bg-sidebar-accent",
      )}
    >
      {renamingTitle ? (
        <span
          className="absolute inset-0 z-10 flex h-full w-full items-center"
          data-thread-title-rename
        >
          <input
            ref={renameInputRef}
            value={renameDraft}
            disabled={renamingCommitting}
            type="text"
            aria-label="Rename thread title"
            className="h-full w-full min-w-0 border-0 bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-0 disabled:opacity-60"
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          />
        </span>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Link
              {...linkProps}
              state={(previous) => ({
                ...previous,
                threadTitleFallback: { threadId: thread.id, title },
              })}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sidebar-foreground/70 outline-none transition-colors hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                confirmingDelete
                  ? "pr-20"
                  : onPin || onUnpin
                    ? "pr-12"
                    : "pr-10",
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
              <span
                className="min-w-0 flex-1 truncate text-sm font-normal"
                data-thread-title-rename
              >
                {title}
              </span>
            </Link>
          </ContextMenuTrigger>
          <ContextMenuContent alignOffset={2} className="w-44">
            <ContextMenuItem
              onSelect={() => {
                window.setTimeout(startRename, 0);
              }}
            >
              <Pencil className="size-4" />
              Rename
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
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
          onMouseLeave={() => setConfirmingDelete(false)}
        >
          Confirm
        </button>
      ) : (
        <>
          {!renamingTitle && relativeDate ? (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs tabular-nums text-sidebar-foreground/45 group-hover/thread-row:hidden"
              title={activity ?? undefined}
            >
              {relativeDate}
            </span>
          ) : null}
          {!renamingTitle ? (
            <button
              type="button"
              className="absolute right-1 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-end rounded-md pr-1.5 text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground/70 group-hover/thread-row:flex"
              aria-label={`Delete ${title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setConfirmingDelete(true);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
          {!renamingTitle && (onPin || onUnpin) ? (
            <button
              type="button"
              className="absolute right-6 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground/75 group-hover/thread-row:flex focus-visible:flex focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
              title={pinned ? "Unpin thread" : "Pin thread"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (pinned) onUnpin?.();
                else onPin?.();
              }}
            >
              <IconPin className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

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

function threadPinsStorageKey(tenantId: string | null, userId: string | null) {
  return `thinkwork:spaces:pinned-threads:${tenantId ?? "unknown-tenant"}:${userId ?? "unknown-user"}`;
}

function threadPinsMigrationStorageKey(
  tenantId: string | null,
  userId: string | null,
) {
  return `${threadPinsStorageKey(tenantId, userId)}:server-migrated:v1`;
}

function readPinnedThreadIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value, index, values): value is string =>
        typeof value === "string" && values.indexOf(value) === index,
    );
  } catch {
    return [];
  }
}

function readPinMigrationCompleted(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writePinMigrationCompleted(key: string) {
  try {
    window.localStorage.setItem(key, "true");
  } catch {
    // localStorage can be unavailable in hardened contexts; server pins still work.
  }
}

interface ThreadSelectedDetail {
  threadId?: string | null;
}

interface ThreadDeletedDetail {
  threadId?: string | null;
}
