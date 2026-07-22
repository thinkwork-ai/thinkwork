import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "urql";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@thinkwork/ui";
import { Sparkles, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SearchAskView,
  type SearchAskViewModel,
} from "@/components/shell/SearchAskView";
import { SearchQuery } from "@/lib/graphql-queries";
import { SEARCH_PALETTE_RAILS_ENABLED } from "@/lib/search-palette-gate";
import { formatTinyRelativeDate } from "@/lib/relative-time";
import {
  isThreadLocallyRead,
  isThreadUnread,
  type ChatThreadSummary,
  type LocallyReadThreadAt,
  threadActivityAt,
  threadTitle,
} from "./chat-sidebar-types";
// graphql-queries.ts is excluded from codegen (untyped urql `gql` tags), so the
// broker operation has no generated document type — we type the useQuery hook
// with the schema types, which ARE generated.
import { SearchLegStatus, SearchSource } from "@/gql/graphql";
import type {
  SearchEntityHit,
  SearchLeg,
  SearchResults,
  SearchThreadHit,
} from "@/gql/graphql";

interface SearchQueryResult {
  search: SearchResults;
}

interface SearchQueryVariables {
  tenantId: string;
  query: string;
  sources: SearchSource[];
  limit: number;
  queryId: string;
}

/** Minimal shape the palette needs to navigate to a thread. */
export interface PaletteThreadTarget {
  id: string;
  spaceId?: string | null;
}

const SEARCH_DEBOUNCE_MS = 200;
const RAIL_LIMIT = 6;

// One rail per broker source. Order is the arrow-traversal order below the
// (optional) dossier card and the Ask row.
const RAILS: ReadonlyArray<{ source: SearchSource; label: string }> = [
  { source: SearchSource.Threads, label: "Threads" },
  { source: SearchSource.Entities, label: "Entities" },
];

export function SearchPalette({
  open,
  onOpenChange,
  tenantId,
  search,
  onSearchChange,
  emptyStateThreads,
  pinnedThreadIds,
  defaultSpaceIds,
  locallyReadThreadAt,
  onSelectThread,
  onSelectEntity,
  onAsk,
  onResearch,
  emptyStateLoading,
  emptyStateError,
  dossierSlot,
  askView,
  onAskBack,
  onAskOpenPermalink,
  askSourcesSlot,
  railsEnabled = SEARCH_PALETTE_RAILS_ENABLED,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  emptyStateThreads: ChatThreadSummary[];
  pinnedThreadIds: ReadonlySet<string>;
  defaultSpaceIds: ReadonlySet<string>;
  locallyReadThreadAt: LocallyReadThreadAt;
  onSelectThread: (thread: PaletteThreadTarget) => void;
  onSelectEntity: (hit: SearchEntityHit) => void;
  onAsk: (query: string) => void;
  /** U9 research escalation: enqueue a background run for the current query. */
  onResearch: (query: string) => void;
  emptyStateLoading: boolean;
  emptyStateError: string | null;
  /** U5 dossier card, rendered above the rails and first in arrow traversal. */
  dossierSlot?: ReactNode;
  /**
   * U7 ask view-model. When non-null, the palette renders the streaming ask
   * answer in place of the rails (the CommandInput stays). Shell-owned so the
   * turn survives palette close/reopen (KTD-6).
   */
  askView?: SearchAskViewModel | null;
  onAskBack?: () => void;
  onAskOpenPermalink?: () => void;
  askSourcesSlot?: ReactNode;
  railsEnabled?: boolean;
}) {
  const [debouncedQuery, setDebouncedQuery] = useState(search.trim());

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedQuery(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  const railsActive = railsEnabled && debouncedQuery.length > 0;

  const handleAsk = () => {
    const query = search.trim();
    if (query) onAsk(query);
  };

  const handleResearch = () => {
    const query = search.trim();
    if (query) onResearch(query);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // ⌘Enter / Ctrl+Enter always escalates to ask, regardless of the
    // highlighted item (Enter alone opens the highlight — cmdk's default).
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleAsk();
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search across threads and entities"
      className="sm:max-w-2xl"
      showCloseButton
    >
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          value={search}
          onValueChange={onSearchChange}
          onKeyDown={handleInputKeyDown}
          placeholder={railsEnabled ? "Search or ask…" : "Search threads"}
          aria-label="Search"
        />
        <CommandList className="scrollbar-auto-hide max-h-[420px]">
          {askView ? (
            <SearchAskView
              view={askView}
              onBack={onAskBack ?? (() => {})}
              onOpenPermalink={onAskOpenPermalink ?? (() => {})}
              sourcesSlot={askSourcesSlot}
            />
          ) : railsActive ? (
            <BrokerRails
              tenantId={tenantId}
              query={debouncedQuery}
              locallyReadThreadAt={locallyReadThreadAt}
              onSelectThread={onSelectThread}
              onSelectEntity={onSelectEntity}
              onAsk={handleAsk}
              onResearch={handleResearch}
              dossierSlot={dossierSlot}
            />
          ) : (
            <EmptyStateThreads
              threads={emptyStateThreads}
              pinnedThreadIds={pinnedThreadIds}
              defaultSpaceIds={defaultSpaceIds}
              locallyReadThreadAt={locallyReadThreadAt}
              onSelectThread={onSelectThread}
              isLoading={emptyStateLoading}
              error={emptyStateError}
            />
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/**
 * Legacy / empty-query view: today's pinned + recent-by-space grouped thread
 * list, rendered verbatim so opening Cmd+K (or running with the rails gate off)
 * shows no regression.
 */
function EmptyStateThreads({
  threads,
  pinnedThreadIds,
  defaultSpaceIds,
  locallyReadThreadAt,
  onSelectThread,
  isLoading,
  error,
}: {
  threads: ChatThreadSummary[];
  pinnedThreadIds: ReadonlySet<string>;
  defaultSpaceIds: ReadonlySet<string>;
  locallyReadThreadAt: LocallyReadThreadAt;
  onSelectThread: (thread: PaletteThreadTarget) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const groups = useMemo(
    () => groupSearchThreads(threads, pinnedThreadIds, defaultSpaceIds),
    [defaultSpaceIds, pinnedThreadIds, threads],
  );

  if (error) {
    return <CommandEmpty className="text-destructive">{error}</CommandEmpty>;
  }
  if (isLoading) {
    return <CommandEmpty>Searching…</CommandEmpty>;
  }
  if (groups.length === 0) {
    return <CommandEmpty>No threads found</CommandEmpty>;
  }

  return (
    <>
      {groups.map((group) => (
        <CommandGroup key={group.key} heading={group.label}>
          {group.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              value={[group.label, threadTitle(thread), thread.identifier]
                .filter(Boolean)
                .join(" ")}
              title={threadTitle(thread)}
              unread={
                isThreadUnread(thread) &&
                !isThreadLocallyRead(thread, locallyReadThreadAt)
              }
              trailing={formatTinyRelativeDate(threadActivityAt(thread))}
              onSelect={() =>
                onSelectThread({ id: thread.id, spaceId: thread.spaceId })
              }
            />
          ))}
        </CommandGroup>
      ))}
    </>
  );
}

/**
 * Typed-query view: one broker rail per source, each fetching independently so
 * a slow or failing rail never blocks the others. An "Ask …" row sits at the
 * top so escalation is discoverable and clickable.
 */
function BrokerRails({
  tenantId,
  query,
  locallyReadThreadAt,
  onSelectThread,
  onSelectEntity,
  onAsk,
  onResearch,
  dossierSlot,
}: {
  tenantId: string | null | undefined;
  query: string;
  locallyReadThreadAt: LocallyReadThreadAt;
  onSelectThread: (thread: PaletteThreadTarget) => void;
  onSelectEntity: (hit: SearchEntityHit) => void;
  onAsk: () => void;
  onResearch: () => void;
  dossierSlot?: ReactNode;
}) {
  // One shared id correlates the parallel per-rail calls of a single palette
  // query in the broker's telemetry (search_queries).
  const queryId = useMemo(
    () => globalThis.crypto?.randomUUID?.() ?? `q-${query}-${Date.now()}`,
    [query],
  );

  return (
    <>
      {dossierSlot}
      <CommandGroup>
        <CommandItem
          value={`__ask__ ${query}`}
          className="h-10"
          onSelect={onAsk}
        >
          <Sparkles className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Ask <span className="text-muted-foreground">“{query}”</span>
          </span>
          <CommandShortcut className="tracking-normal">⌘↵</CommandShortcut>
        </CommandItem>
        <CommandItem
          value={`__research__ ${query}`}
          className="h-10"
          onSelect={onResearch}
        >
          <Telescope className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Research this{" "}
            <span className="text-muted-foreground">“{query}”</span>
          </span>
        </CommandItem>
      </CommandGroup>
      {RAILS.map((rail) => (
        <BrokerRail
          key={rail.source}
          tenantId={tenantId}
          query={query}
          queryId={queryId}
          source={rail.source}
          label={rail.label}
          locallyReadThreadAt={locallyReadThreadAt}
          onSelectThread={onSelectThread}
          onSelectEntity={onSelectEntity}
        />
      ))}
    </>
  );
}

function BrokerRail({
  tenantId,
  query,
  queryId,
  source,
  label,
  locallyReadThreadAt,
  onSelectThread,
  onSelectEntity,
}: {
  tenantId: string | null | undefined;
  query: string;
  queryId: string;
  source: SearchSource;
  label: string;
  locallyReadThreadAt: LocallyReadThreadAt;
  onSelectThread: (thread: PaletteThreadTarget) => void;
  onSelectEntity: (hit: SearchEntityHit) => void;
}) {
  const [{ data, fetching, error }] = useQuery<
    SearchQueryResult,
    SearchQueryVariables
  >({
    query: SearchQuery,
    variables: {
      tenantId: tenantId ?? "",
      query,
      sources: [source],
      limit: RAIL_LIMIT,
      queryId,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const leg: SearchLeg | undefined = data?.search?.legs?.find(
    (candidate) => candidate.source === source,
  );
  const status: SearchLegStatus | "PENDING" = leg?.status ?? "PENDING";
  const railError = error?.message ?? leg?.error ?? null;

  return (
    <CommandGroup heading={label}>
      <RailBody
        source={source}
        label={label}
        leg={leg}
        status={status}
        error={railError}
        fetching={fetching && !data}
        locallyReadThreadAt={locallyReadThreadAt}
        onSelectThread={onSelectThread}
        onSelectEntity={onSelectEntity}
      />
    </CommandGroup>
  );
}

function RailBody({
  source,
  label,
  leg,
  status,
  error,
  fetching,
  locallyReadThreadAt,
  onSelectThread,
  onSelectEntity,
}: {
  source: SearchSource;
  label: string;
  leg: SearchLeg | undefined;
  status: SearchLegStatus | "PENDING";
  error: string | null;
  fetching: boolean;
  locallyReadThreadAt: LocallyReadThreadAt;
  onSelectThread: (thread: PaletteThreadTarget) => void;
  onSelectEntity: (hit: SearchEntityHit) => void;
}) {
  // Distinct per-rail states — one rail's failure never blocks another's.
  if (error || status === SearchLegStatus.Error) {
    return <RailNote tone="error">Search unavailable</RailNote>;
  }
  if (status === SearchLegStatus.Timeout) {
    return <RailNote tone="muted">Still searching…</RailNote>;
  }
  if (fetching || status === "PENDING") {
    return <RailNote tone="muted">Searching…</RailNote>;
  }

  if (source === SearchSource.Threads) {
    const hits = leg?.threadHits ?? [];
    if (hits.length === 0) return <RailNote tone="muted">No matches</RailNote>;
    return (
      <>
        {hits.map((hit: SearchThreadHit) => (
          <ThreadRow
            key={hit.id}
            value={`thread ${label} ${hit.title ?? ""} ${hit.identifier ?? ""} ${hit.id}`}
            title={hit.title ?? "Untitled thread"}
            unread={false}
            trailing={formatTinyRelativeDate(hit.updatedAt)}
            onSelect={() =>
              onSelectThread({ id: hit.id, spaceId: hit.spaceId })
            }
          />
        ))}
      </>
    );
  }

  // ENTITIES
  const hits = leg?.entityHits ?? [];
  if (hits.length === 0) return <RailNote tone="muted">No matches</RailNote>;
  return (
    <>
      {hits.map((hit: SearchEntityHit) => (
        <CommandItem
          key={hit.entityId}
          value={`entity ${hit.label} ${(hit.aliases ?? []).join(" ")}`}
          className="h-10"
          onSelect={() => onSelectEntity(hit)}
        >
          <span className="min-w-0 flex-1 truncate">{hit.label}</span>
          {hit.ontologyTypeSlug ? (
            <CommandShortcut className="tracking-normal">
              {hit.ontologyTypeSlug}
            </CommandShortcut>
          ) : null}
        </CommandItem>
      ))}
    </>
  );
}

function RailNote({
  tone,
  children,
}: {
  tone: "muted" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      role="status"
    >
      {children}
    </div>
  );
}

function ThreadRow({
  value,
  title,
  unread,
  trailing,
  onSelect,
}: {
  value: string;
  title: string;
  unread: boolean;
  trailing: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={value} className="h-10" onSelect={onSelect}>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? (
        <CommandShortcut className="tracking-normal">
          {trailing}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}

/**
 * Groups threads into Pinned / per-Space / Chats sections for the empty-query
 * view. Moved verbatim from ChatSidebar's ThreadSearchDialog (THINK-263 U4).
 */
export function groupSearchThreads(
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
