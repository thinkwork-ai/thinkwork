import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { AdminAppletsQuery } from "@/lib/applet-admin-queries";
import { type AppletPreviewNode, toAppletPreview } from "@/lib/app-artifacts";
import { computerArtifactRoute } from "@/lib/computer-routes";
import { AppletsQuery } from "@/lib/graphql-queries";
import { ArtifactsTable } from "./ArtifactsTable";
import { ArtifactsToolbar } from "./ArtifactsToolbar";
import {
  ALL_KINDS,
  DEFAULT_SORT_BY,
  TAB_ALL,
  filterArtifactItems,
  sortArtifactItems,
  toArtifactItem,
  uniqueKinds,
  type ArtifactItem,
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
}

export function ArtifactsListBody({
  items: itemsProp,
  fetching: fetchingProp,
  errorMessage: errorMessageProp,
  isOperator: isOperatorProp,
  roleResolved: roleResolvedProp,
  detailPathFor = computerArtifactRoute,
}: ArtifactsListBodyProps = {}) {
  if (itemsProp) {
    return (
      <StaticArtifactsListBody
        items={itemsProp}
        fetching={fetchingProp ?? false}
        errorMessage={errorMessageProp}
        showUserFilter={(roleResolvedProp ?? true) && !!isOperatorProp}
        detailPathFor={detailPathFor}
      />
    );
  }
  return <LiveArtifactsListBody detailPathFor={detailPathFor} />;
}

// Test-seam path: holds the filter input state locally so the affordance is
// interactive in tests without driving a live query switch.
function StaticArtifactsListBody({
  items,
  fetching,
  errorMessage,
  showUserFilter,
  detailPathFor,
}: {
  items: ArtifactItem[];
  fetching: boolean;
  errorMessage?: string;
  showUserFilter: boolean;
  detailPathFor: (id: string) => string;
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
    />
  );
}

function LiveArtifactsListBody({
  detailPathFor,
}: {
  detailPathFor: (id: string) => string;
}) {
  // Operator state lives in the live-data layer (not the presentational
  // toolbar) because the user-ID filter switches which query runs. Gate on
  // `roleResolved` so the affordance never flashes before the role is known.
  const { isOperator, roleResolved, tenantId } = useTenant();
  const operatorReady = roleResolved && isOperator;

  const [userIdFilter, setUserIdFilter] = useState("");
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

  const source = filterActive ? adminResult : defaultResult;
  const rawNodes = filterActive
    ? adminResult.data?.adminApplets?.nodes
    : defaultResult.data?.applets?.nodes;

  const items: ArtifactItem[] = useMemo(
    () =>
      (rawNodes ?? []).map((node) =>
        toArtifactItem(toAppletPreview(node as AppletPreviewNode)),
      ),
    [rawNodes],
  );

  return (
    <ArtifactsListBodyView
      items={items}
      fetching={source.fetching}
      errorMessage={source.error?.message}
      showUserFilter={operatorReady}
      userIdFilter={userIdFilter}
      onUserIdFilterChange={setUserIdFilter}
      filterActive={filterActive}
      detailPathFor={detailPathFor}
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
  detailPathFor,
}: {
  items: ArtifactItem[];
  fetching: boolean;
  errorMessage?: string;
  showUserFilter: boolean;
  userIdFilter: string;
  onUserIdFilterChange: (value: string) => void;
  filterActive: boolean;
  detailPathFor: (id: string) => string;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>(TAB_ALL);
  const [kind, setKind] = useState<string>(ALL_KINDS);

  const kinds = useMemo(() => uniqueKinds(items), [items]);
  // Fixed sort (generated, newest first) — no user-facing sort control.
  const sortedItems = useMemo(
    () => sortArtifactItems(items, DEFAULT_SORT_BY),
    [items],
  );
  const filtered = useMemo(
    () => filterArtifactItems({ items: sortedItems, search, kind, tab }),
    [sortedItems, search, kind, tab],
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
      <ArtifactsToolbar
        search={search}
        onSearchChange={setSearch}
        tab={tab}
        onTabChange={setTab}
        kind={kind}
        kinds={kinds}
        onKindChange={setKind}
        showUserFilter={showUserFilter}
        userIdFilter={userIdFilter}
        onUserIdFilterChange={onUserIdFilterChange}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
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
