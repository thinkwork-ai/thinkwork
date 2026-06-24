import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  DeleteWorkItemViewMutation,
  CreateWorkItemMutation,
  SpacesQuery,
  UpdateWorkItemStatusMutation,
  WorkItemSavedViewsQuery,
  WorkItemStatusesQuery,
  WorkItemsQuery,
} from "@/lib/graphql-queries";
import {
  WORK_ITEM_PRIORITY_ORDER,
  categoryStatuses,
  isWorkItemDueSoon,
  isWorkItemOpen,
  sortWorkItemStatuses,
  type WorkItemSavedViewSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemStatusCategory,
} from "./work-item-display";
import {
  buildWorkItemsInput,
  routeSearchFromSavedView,
  workItemRouteSearchToParams,
  type WorkItemRouteSearch,
} from "./work-item-filters";
import { WorkItemDisplayPopover } from "./WorkItemDisplayPopover";
import { WorkItemFilters } from "./WorkItemFilters";
import {
  NewWorkItemSheet,
  type NewWorkItemFormInput,
} from "./NewWorkItemSheet";
import { WorkItemSavedViews } from "./WorkItemSavedViews";
import { WorkItemsBoardView } from "./WorkItemsBoardView";
import { WorkItemsListView } from "./WorkItemsListView";

interface WorkItemsResult {
  workItems?: WorkItemSummary[] | null;
}

interface WorkItemStatusesResult {
  workItemStatuses?: WorkItemStatusSummary[] | null;
}

interface WorkItemSavedViewsResult {
  workItemSavedViews?: WorkItemSavedViewSummary[] | null;
}

interface SpacesResult {
  spaces?: WorkItemSpaceSummary[] | null;
}

interface WorkItemsPageProps {
  tenantId: string | null;
  state: WorkItemRouteSearch;
  onStateChange: (next: WorkItemRouteSearch) => void;
}

export function WorkItemsPage({
  tenantId,
  state,
  onStateChange,
}: WorkItemsPageProps) {
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [newWorkItemOpen, setNewWorkItemOpen] = useState(false);
  const input = useMemo(
    () => (tenantId ? buildWorkItemsInput(tenantId, state) : undefined),
    [state, tenantId],
  );
  const [{ data, fetching, error }, reexecuteItems] = useQuery<WorkItemsResult>(
    {
      query: WorkItemsQuery,
      variables: { input },
      pause: !tenantId || !input,
      requestPolicy: "cache-and-network",
    },
  );
  const [{ data: spacesData }] = useQuery<SpacesResult>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: statusesData }] = useQuery<WorkItemStatusesResult>({
    query: WorkItemStatusesQuery,
    variables: { tenantId: tenantId ?? "", spaceId: state.spaceId ?? "" },
    pause: !tenantId || !state.spaceId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: savedViewsData, fetching: savedViewsFetching },
    reexecuteSavedViews,
  ] = useQuery<WorkItemSavedViewsResult>({
    query: WorkItemSavedViewsQuery,
    variables: { tenantId: tenantId ?? "", spaceId: state.spaceId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: statusUpdating }, executeStatusUpdate] = useMutation(
    UpdateWorkItemStatusMutation,
  );
  const [{ fetching: creatingWorkItem }, executeCreateWorkItem] = useMutation(
    CreateWorkItemMutation,
  );
  const [{ fetching: deletingView }, executeDeleteView] = useMutation(
    DeleteWorkItemViewMutation,
  );

  useEffect(() => {
    if (!tenantId) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        reexecuteItems({ requestPolicy: "network-only" });
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reexecuteItems, tenantId]);

  const spaces = spacesData?.spaces ?? [];
  const savedViews = savedViewsData?.workItemSavedViews ?? [];
  const workItems = useMemo(
    () => sortWorkItems(data?.workItems ?? [], state.sort),
    [data?.workItems, state.sort],
  );
  const statuses = useMemo(() => {
    const spaceStatuses = sortWorkItemStatuses(
      statusesData?.workItemStatuses ?? [],
    );
    if (state.spaceId && spaceStatuses.length > 0) return spaceStatuses;
    return categoryStatuses();
  }, [state.spaceId, statusesData?.workItemStatuses]);

  const handleStatusChange = useCallback(
    async (item: WorkItemSummary, status: WorkItemStatusSummary) => {
      if (!tenantId || statusUpdating) return;
      setUpdatingItemId(item.id);
      const result = await executeStatusUpdate({
        input: {
          tenantId,
          workItemId: item.id,
          statusId: status.spaceId ? status.id : undefined,
          statusCategory: status.spaceId ? undefined : status.category,
        },
      });
      setUpdatingItemId(null);
      if (result.error) {
        toast.error(`Couldn't update status: ${result.error.message}`);
        return;
      }
      toast.success("Work Item updated");
      reexecuteItems({ requestPolicy: "network-only" });
    },
    [executeStatusUpdate, reexecuteItems, statusUpdating, tenantId],
  );

  const handleCreateWorkItem = useCallback(
    async (form: NewWorkItemFormInput) => {
      if (!tenantId || creatingWorkItem) return false;
      const result = await executeCreateWorkItem({
        input: {
          tenantId,
          ...form,
        },
      });
      if (result.error) {
        toast.error(`Couldn't create Work Item: ${result.error.message}`);
        return false;
      }
      toast.success("Work Item created");
      reexecuteItems({ requestPolicy: "network-only" });
      return true;
    },
    [creatingWorkItem, executeCreateWorkItem, reexecuteItems, tenantId],
  );

  const handleDeleteView = useCallback(
    async (view: WorkItemSavedViewSummary) => {
      if (!tenantId) return;
      const confirmed = window.confirm(`Delete saved view "${view.name}"?`);
      if (!confirmed) return;
      const result = await executeDeleteView({
        input: { tenantId, id: view.id },
      });
      if (result.error) {
        toast.error(`Couldn't delete view: ${result.error.message}`);
        return;
      }
      if (state.savedViewId === view.id) {
        onStateChange({ ...state, savedViewId: undefined });
      }
      reexecuteSavedViews({ requestPolicy: "network-only" });
      toast.success("View deleted");
    },
    [executeDeleteView, onStateChange, reexecuteSavedViews, state, tenantId],
  );

  const updateState = useCallback(
    (next: WorkItemRouteSearch) => {
      onStateChange({
        ...next,
        view: next.view ?? "list",
        sort: next.sort ?? "updated",
      });
    },
    [onStateChange],
  );

  usePageHeaderActions({
    title: "Work Items",
    documentTitle: "Work Items",
    action: (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="New Work Item"
          title="New Work Item"
          onClick={() => setNewWorkItemOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
        <WorkItemSavedViews
          views={savedViews}
          activeViewId={state.savedViewId}
          deleting={deletingView}
          onSelectView={(view) =>
            updateState(
              view
                ? routeSearchFromSavedView(view)
                : {
                    ...state,
                    savedViewId: undefined,
                  },
            )
          }
          onDeleteView={handleDeleteView}
        />
        <WorkItemDisplayPopover state={state} onChange={updateState} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Refresh Work Items"
          title="Refresh Work Items"
          onClick={() => reexecuteItems({ requestPolicy: "network-only" })}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
    ),
    actionKey: `work-items:${JSON.stringify(state)}:${savedViews.map((view) => `${view.id}:${view.name}`).join("|")}:${deletingView ? "deleting" : "idle"}`,
  });

  if (!tenantId || (fetching && !data)) {
    return <PageSkeleton />;
  }

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-col p-6">
        <SettingsPageTitle
          title="Work Items"
          description="Track Space work items, blockers, and thread-linked progress."
        />
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <WorkItemFilters
            state={state}
            spaces={spaces}
            onChange={updateState}
          />
        </div>

        {error ? (
          <div className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error.message}
          </div>
        ) : null}
        {savedViewsFetching ? (
          <div className="sr-only">Loading saved views</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {state.view === "board" ? (
            <WorkItemsBoardView
              items={workItems}
              spaces={spaces}
              statuses={statuses}
              updatingItemId={updatingItemId}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <WorkItemsListView
              items={workItems}
              spaces={spaces}
              statuses={statuses}
              includeSpace={!state.spaceId}
              updatingItemId={updatingItemId}
              onStatusChange={handleStatusChange}
            />
          )}
        </div>
      </div>
      <NewWorkItemSheet
        open={newWorkItemOpen}
        spaces={spaces}
        defaultSpaceId={state.spaceId}
        saving={creatingWorkItem}
        onOpenChange={setNewWorkItemOpen}
        onCreate={handleCreateWorkItem}
      />
    </main>
  );
}

export function summarizeWorkItems(items: WorkItemSummary[]) {
  return items.reduce(
    (acc, item) => {
      if (isWorkItemOpen(item)) {
        acc.open += 1;
        if (item.required) acc.requiredOpen += 1;
      }
      if (item.blocked || workItemStatusCategory(item) === "BLOCKED") {
        acc.blocked += 1;
      }
      if (isWorkItemOpen(item) && isWorkItemDueSoon(item.dueAt)) {
        acc.dueSoon += 1;
      }
      return acc;
    },
    { open: 0, requiredOpen: 0, blocked: 0, dueSoon: 0 },
  );
}

export function sortWorkItems(
  items: WorkItemSummary[],
  sort: WorkItemRouteSearch["sort"] = "updated",
) {
  return [...items].sort((left, right) => {
    if (sort === "title") return left.title.localeCompare(right.title);
    if (sort === "priority") {
      return (
        WORK_ITEM_PRIORITY_ORDER.indexOf(left.priority) -
        WORK_ITEM_PRIORITY_ORDER.indexOf(right.priority)
      );
    }
    if (sort === "due") {
      return dateAsc(left.dueAt) - dateAsc(right.dueAt);
    }
    return dateDesc(right.updatedAt) - dateDesc(left.updatedAt);
  });
}

function dateAsc(value?: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function dateDesc(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function buildWorkItemsRouteParams(state: WorkItemRouteSearch) {
  return workItemRouteSearchToParams(state);
}
