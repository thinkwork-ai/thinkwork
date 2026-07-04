import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { AdminAppletsQuery } from "@/lib/applet-admin-queries";
import { type AppletPreviewNode, toAppletPreview } from "@/lib/app-artifacts";
import { computerArtifactRoute } from "@/lib/computer-routes";
import { AppletsQuery, TenantArtifactsListQuery } from "@/lib/graphql-queries";
import { ArtifactsTable } from "./ArtifactsTable";
import { ArtifactsToolbar } from "./ArtifactsToolbar";
import {
  artifactNodeToItem,
  DEFAULT_SORT_BY,
  filterArtifactItems,
  sortArtifactItems,
  toArtifactItem,
  type ArtifactItem,
  type ArtifactListNode,
} from "./artifacts-filtering";

interface AppletsResult {
  applets?: {
    nodes?: AppletPreviewNode[] | null;
    nextCursor?: string | null;
  } | null;
}

export interface ArtifactsListBodyProps {
  /** Test seam: when provided, skips the live urql query. */
  items?: ArtifactItem[];
  fetching?: boolean;
  errorMessage?: string;
  /**
   * Test seam: force the operator user-ID filter affordance on/off without a
   * TenantContext. Defaults to hidden, matching a non-operator viewer.
   */
  isOperator?: boolean;
  roleResolved?: boolean;
  /**
   * Builds the route a clicked row navigates to. Defaults to the main-shell
   * artifact viewer; the Settings embed passes a `/settings/artifacts/$id`
   * builder so the detail stays inside the Settings shell.
   */
  detailPathFor?: (id: string) => string;
  /**
   * Optional page header (title + description) rendered above the toolbar.
   * The Settings embed passes a `SettingsPageTitle` so Artifacts matches the
   * other settings pages; the main shell leaves it unset (breadcrumb only).
   */
  headerSlot?: ReactNode;
}

export function ArtifactsListBody({
  items: itemsProp,
  fetching: fetchingProp,
  errorMessage: errorMessageProp,
  isOperator: isOperatorProp,
  roleResolved: roleResolvedProp,
  detailPathFor = computerArtifactRoute,
  headerSlot,
}: ArtifactsListBodyProps = {}) {
  if (itemsProp) {
    return (
      <StaticArtifactsListBody
        items={itemsProp}
        fetching={fetchingProp ?? false}
        errorMessage={errorMessageProp}
        showUserFilter={(roleResolvedProp ?? true) && !!isOperatorProp}
        detailPathFor={detailPathFor}
        headerSlot={headerSlot}
      />
    );
  }
  return (
    <LiveArtifactsListBody
      detailPathFor={detailPathFor}
      headerSlot={headerSlot}
    />
  );
}

// Test-seam path: holds the filter input state locally so the affordance is
// interactive in tests without driving a live query switch.
function StaticArtifactsListBody({
  items,
  fetching,
  errorMessage,
  showUserFilter,
  detailPathFor,
  headerSlot,
}: {
  items: ArtifactItem[];
  fetching: boolean;
  errorMessage?: string;
  showUserFilter: boolean;
  detailPathFor: (id: string) => string;
  headerSlot?: ReactNode;
}) {
  const [userIdFilter, setUserIdFilter] = useState("");
  return (
    <ArtifactsListBodyView
      items={items}
      fetching={fetching}
      errorMessage={errorMessage}
      showUserFilter={showUserFilter}
      userIdFilter={userIdFilter}
      onUserIdFilterChange={setUserIdFilter}
      filterActive={false}
      detailPathFor={detailPathFor}
      headerSlot={headerSlot}
    />
  );
}

function LiveArtifactsListBody({
  detailPathFor,
  headerSlot,
}: {
  detailPathFor: (id: string) => string;
  headerSlot?: ReactNode;
}) {
  // Operator state lives in the live-data layer (not the presentational
  // toolbar) because the user-ID filter switches which query runs. Gate on
  // `roleResolved` so the affordance never flashes before the role is known.
  const { isOperator, roleResolved, tenantId } = useTenant();
  const operatorReady = roleResolved && isOperator;

  const [userIdFilter, setUserIdFilter] = useState("");
  // R14: canvas rows default to saved-only; the toggle flips includeDrafts.
  const [includeDrafts, setIncludeDrafts] = useState(false);
  // Debounce the value that drives the query so a typed user ID issues ONE
  // admin request, not one per keystroke. The input itself stays instant.
  const trimmedUserId = useDebouncedValue(userIdFilter.trim(), 250);
  // tenantId always comes from TenantContext, never a route param or
  // user-editable field — the server still re-enforces requireTenantAdmin.
  const filterActive = operatorReady && !!tenantId && trimmedUserId.length > 0;

  const [defaultResult] = useQuery<AppletsResult>({
    query: AppletsQuery,
    requestPolicy: "cache-and-network",
    pause: filterActive,
  });
  const [adminResult] = useQuery({
    query: AdminAppletsQuery,
    variables: {
      tenantId: tenantId ?? "",
      userId: trimmedUserId || undefined,
    },
    requestPolicy: "cache-and-network",
    pause: !filterActive,
  });

  // Every artifact kind (living canvases, HTML documents, plugin-minted types)
  // joins the list via the tenant-wide artifacts query. Suppressed while the
  // operator user-ID filter is active (that view is applet-scoped by user).
  const [artifactsResult] = useQuery<{ artifacts?: ArtifactListNode[] | null }>(
    {
      query: TenantArtifactsListQuery,
      variables: { tenantId: tenantId ?? "", includeDrafts },
      requestPolicy: "cache-and-network",
      pause: !tenantId || filterActive,
    },
  );

  const source = filterActive ? adminResult : defaultResult;
  const rawNodes = filterActive
    ? adminResult.data?.adminApplets?.nodes
    : defaultResult.data?.applets?.nodes;

  const items: ArtifactItem[] = useMemo(() => {
    const appletItems = (rawNodes ?? []).map((node) =>
      toArtifactItem(toAppletPreview(node as AppletPreviewNode)),
    );
    if (filterActive) return appletItems;
    // Map every non-applet artifact row (applet-kind rows return null and are
    // dropped — they're already covered by the applets query above).
    const artifactItems = (artifactsResult.data?.artifacts ?? [])
      .map(artifactNodeToItem)
      .filter((item): item is ArtifactItem => item !== null);
    return [...appletItems, ...artifactItems];
  }, [rawNodes, filterActive, artifactsResult.data?.artifacts]);

  return (
    <ArtifactsListBodyView
      items={items}
      fetching={source.fetching}
      errorMessage={source.error?.message}
      showUserFilter={operatorReady}
      userIdFilter={userIdFilter}
      onUserIdFilterChange={setUserIdFilter}
      filterActive={filterActive}
      includeDrafts={includeDrafts}
      onIncludeDraftsChange={setIncludeDrafts}
      detailPathFor={detailPathFor}
      headerSlot={headerSlot}
    />
  );
}

function ArtifactsListBodyView({
  items,
  fetching,
  errorMessage,
  showUserFilter,
  userIdFilter,
  onUserIdFilterChange,
  filterActive,
  includeDrafts,
  onIncludeDraftsChange,
  detailPathFor,
  headerSlot,
}: {
  items: ArtifactItem[];
  fetching: boolean;
  errorMessage?: string;
  showUserFilter: boolean;
  userIdFilter: string;
  onUserIdFilterChange: (value: string) => void;
  filterActive: boolean;
  includeDrafts?: boolean;
  onIncludeDraftsChange?: (value: boolean) => void;
  detailPathFor: (id: string) => string;
  headerSlot?: ReactNode;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  // Fixed sort (generated, newest first) — no user-facing sort control.
  const sortedItems = useMemo(
    () => sortArtifactItems(items, DEFAULT_SORT_BY),
    [items],
  );
  const filtered = useMemo(
    () => filterArtifactItems({ items: sortedItems, search }),
    [sortedItems, search],
  );

  const handleRowClick = useCallback(
    (item: ArtifactItem) => {
      navigate({ to: detailPathFor(item.id) });
    },
    [navigate, detailPathFor],
  );

  const showLoadingShell = fetching && items.length === 0 && !errorMessage;
  const showErrorShell = !!errorMessage && items.length === 0;

  const emptyMessage = errorMessage
    ? `Couldn't load artifacts: ${errorMessage}`
    : fetching
      ? "Loading artifacts…"
      : items.length === 0
        ? filterActive
          ? "No artifacts found for this user ID."
          : "Ask ThinkWork to create an artifact and it will appear here."
        : "No artifacts match your filters.";

  return (
    <div className="flex h-full min-w-0 flex-col">
      {headerSlot ? <div className="px-6 pt-6">{headerSlot}</div> : null}
      <ArtifactsToolbar
        search={search}
        onSearchChange={setSearch}
        showUserFilter={showUserFilter}
        userIdFilter={userIdFilter}
        onUserIdFilterChange={onUserIdFilterChange}
        includeDrafts={includeDrafts}
        onIncludeDraftsChange={onIncludeDraftsChange}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4">
        {showLoadingShell ? (
          <div
            className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
            data-testid="artifacts-loading"
          >
            Loading artifacts…
          </div>
        ) : showErrorShell ? (
          <div
            className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
            data-testid="artifacts-error"
          >
            {emptyMessage}
          </div>
        ) : (
          <ArtifactsTable
            items={filtered}
            emptyMessage={emptyMessage}
            onRowClick={handleRowClick}
          />
        )}
      </div>
    </div>
  );
}

// Returns `value` delayed by `delayMs`, collapsing rapid changes (e.g. typing
// in the operator user-ID filter) into a single settled value so we issue one
// query per pause instead of one per keystroke.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ArtifactsCreateAction() {
  return (
    <Button asChild size="sm">
      <Link to="/new" search={{ spaceId: undefined }}>
        New thread
      </Link>
    </Button>
  );
}
