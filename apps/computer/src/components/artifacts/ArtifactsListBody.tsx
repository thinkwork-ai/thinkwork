import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import {
  type AppletPreviewNode,
  toAppletPreview,
} from "@/lib/app-artifacts";
import { computerArtifactRoute } from "@/lib/computer-routes";
import { AppletsQuery } from "@/lib/graphql-queries";
import { ArtifactsTable } from "./ArtifactsTable";
import { ArtifactsToolbar } from "./ArtifactsToolbar";
import {
  ALL_KINDS,
  TAB_ALL,
  filterArtifactItems,
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
}

export function ArtifactsListBody({
  items: itemsProp,
  fetching: fetchingProp,
  errorMessage: errorMessageProp,
}: ArtifactsListBodyProps = {}) {
  if (itemsProp) {
    return (
      <ArtifactsListBodyView
        items={itemsProp}
        fetching={fetchingProp ?? false}
        errorMessage={errorMessageProp}
      />
    );
  }
  return <LiveArtifactsListBody />;
}

function LiveArtifactsListBody() {
  const [{ data, fetching, error }] = useQuery<AppletsResult>({
    query: AppletsQuery,
    requestPolicy: "cache-and-network",
  });
  const items: ArtifactItem[] = useMemo(
    () =>
      (data?.applets?.nodes ?? []).map((node) =>
        toArtifactItem(toAppletPreview(node)),
      ),
    [data?.applets?.nodes],
  );
  return (
    <ArtifactsListBodyView
      items={items}
      fetching={fetching}
      errorMessage={error?.message}
    />
  );
}

function ArtifactsListBodyView({
  items,
  fetching,
  errorMessage,
}: {
  items: ArtifactItem[];
  fetching: boolean;
  errorMessage?: string;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>(TAB_ALL);
  const [kind, setKind] = useState<string>(ALL_KINDS);

  const kinds = useMemo(() => uniqueKinds(items), [items]);
  const sortedItems = useMemo(
    () => items.slice().sort((a, b) => a.title.localeCompare(b.title)),
    [items],
  );
  const filtered = useMemo(
    () => filterArtifactItems({ items: sortedItems, search, kind, tab }),
    [sortedItems, search, kind, tab],
  );

  const handleRowClick = useCallback(
    (item: ArtifactItem) => {
      navigate({ to: computerArtifactRoute(item.id) });
    },
    [navigate],
  );

  const showLoadingShell = fetching && items.length === 0 && !errorMessage;
  const showErrorShell = !!errorMessage && items.length === 0;

  const emptyMessage = errorMessage
    ? `Couldn't load artifacts: ${errorMessage}`
    : fetching
      ? "Loading artifacts…"
      : items.length === 0
        ? "Ask Computer to create an artifact and it will appear here."
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

export function ArtifactsCreateAction() {
  return (
    <Button asChild size="sm">
      <Link to="/new">Create artifact</Link>
    </Button>
  );
}
