import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Anchor,
  Archive,
  ArrowLeft,
  GalleryVerticalEnd,
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
  User,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidebarGroup,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { SpacesQuery, ThreadsPagedQuery } from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";
import {
  groupThreadsByRecency,
  isThreadUnread,
  sortThreadsByActivityDesc,
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

const RECENT_LIMIT = 60;
const SEARCH_LIMIT = 30;

export function ChatSidebar() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const routeSpaceId = spaceIdFromThreadPath(location.pathname);
  const querySpaceId =
    typeof location.search?.spaceId === "string"
      ? location.search.spaceId
      : undefined;
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

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
  const defaultSpaceId =
    spaces.find((space) => isGeneralSpace(space))?.id ?? spaces[0]?.id;
  const activeSpaceId = querySpaceId ?? routeSpaceId ?? defaultSpaceId;

  const [{ data: recentData, fetching: recentFetching, error: recentError }] =
    useQuery<ThreadsPagedResult>({
      query: ThreadsPagedQuery,
      variables: {
        tenantId: tenantId ?? "",
        showArchived: false,
        sortField: "updated",
        sortDir: "desc",
        spaceId: activeSpaceId,
        limit: RECENT_LIMIT,
        offset: 0,
      },
      pause: !tenantId || !activeSpaceId,
      requestPolicy: "cache-and-network",
    });

  const [{ data: searchData, fetching: searchFetching, error: searchError }] =
    useQuery<ThreadsPagedResult>({
      query: ThreadsPagedQuery,
      variables: {
        tenantId: tenantId ?? "",
        search: debouncedSearch.trim() || undefined,
        showArchived: false,
        sortField: "updated",
        sortDir: "desc",
        spaceId: activeSpaceId,
        limit: SEARCH_LIMIT,
        offset: 0,
      },
      pause: !tenantId || !activeSpaceId || !searchOpen,
      requestPolicy: "cache-and-network",
    });

  const recentThreads = useMemo(
    () => sortThreadsByActivityDesc(recentData?.threadsPaged?.items ?? []),
    [recentData?.threadsPaged?.items],
  );
  const recentGroups = useMemo(
    () => groupThreadsByRecency(recentThreads),
    [recentThreads],
  );
  const searchThreads = useMemo(
    () => sortThreadsByActivityDesc(searchData?.threadsPaged?.items ?? []),
    [searchData?.threadsPaged?.items],
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
          <Select
            value={activeSpaceId}
            onValueChange={(value) => {
              void navigate({
                to: "/threads",
                search: { spaceId: value },
              });
            }}
            disabled={!tenantId || spaces.length === 0 || spacesFetching}
          >
            <SelectTrigger
              aria-label="Switch Space"
              className={navItemClassName}
            >
              <GalleryVerticalEnd className="size-4 shrink-0" />
              <SelectValue placeholder="General" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="bottom"
              align="start"
              sideOffset={4}
              avoidCollisions={false}
              className="w-[var(--radix-select-trigger-width)]"
            >
              {spaces.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name ?? space.slug ?? "Space"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="ghost" className={navItemClassName}>
            <Link to="/new">
              <MessageCirclePlus className="size-4 shrink-0" />
              <span>New chat</span>
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
        {spacesError ? (
          <p className="mt-2 px-2 text-xs text-destructive">
            Spaces failed to load.
          </p>
        ) : null}
      </div>

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
          ) : recentThreads.length === 0 ? (
            <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
              No threads yet
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
        <div className="max-h-[420px] overflow-y-auto p-2">
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
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 group-data-[collapsible=icon]:hidden">
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
}: {
  thread: ChatThreadSummary;
  active: boolean;
}) {
  const unread = isThreadUnread(thread);
  const content = (
    <>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {threadTitle(thread)}
      </span>
    </>
  );

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

const navItemClassName =
  "flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm font-normal text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function threadRowClass(active: boolean) {
  return cn(
    "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
}

function isGeneralSpace(space: SpaceNavSummary) {
  return (
    space.slug?.toLowerCase() === "general" ||
    space.name?.toLowerCase() === "general"
  );
}

function spaceIdFromThreadPath(pathname: string) {
  const match = /^\/spaces\/([^/]+)\/threads\/[^/]+/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}
