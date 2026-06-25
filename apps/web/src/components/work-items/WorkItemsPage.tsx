import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  CreateWorkItemMutation,
  SpacesQuery,
  UpdateWorkItemStatusMutation,
  WorkItemStatusesQuery,
  WorkItemsQuery,
} from "@/lib/graphql-queries";
import {
  WORK_ITEM_PRIORITY_ORDER,
  categoryStatuses,
  isWorkItemDueSoon,
  isWorkItemOpen,
  sortWorkItemStatuses,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemStatusCategory,
} from "./work-item-display";
import {
  buildWorkItemsInput,
  workItemRouteSearchToParams,
  type WorkItemRouteSearch,
} from "./work-item-filters";
import type { WorkItemDisplaySort } from "./work-item-view-display";
import { WorkItemDisplayHeader } from "./WorkItemDisplayHeader";
import {
  NewWorkItemSheet,
  type NewWorkItemFormInput,
} from "./NewWorkItemSheet";
import { WorkItemsBoardView } from "./WorkItemsBoardView";
import { WorkItemsListView } from "./WorkItemsListView";

interface WorkItemsResult {
  workItems?: WorkItemSummary[] | null;
}

interface WorkItemStatusesResult {
  workItemStatuses?: WorkItemStatusSummary[] | null;
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
  const [{ fetching: statusUpdating }, executeStatusUpdate] = useMutation(
    UpdateWorkItemStatusMutation,
  );
  const [{ fetching: creatingWorkItem }, executeCreateWorkItem] = useMutation(
    CreateWorkItemMutation,
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
  const workItems = data?.workItems ?? [];
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

  const updateState = useCallback(
    (next: WorkItemRouteSearch) => {
      onStateChange(next);
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
        <WorkItemDisplayHeader state={state} onChange={updateState} />
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
    actionKey: `work-items:${JSON.stringify(state)}`,
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
        {error ? (
          <div className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error.message}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {state.view === "board" ? (
            <WorkItemsBoardView
              items={workItems}
              spaces={spaces}
              statuses={statuses}
              display={state.board}
              updatingItemId={updatingItemId}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <WorkItemsListView
              items={workItems}
              spaces={spaces}
              statuses={statuses}
              display={state.list}
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
  sort: WorkItemDisplaySort = "updated",
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
