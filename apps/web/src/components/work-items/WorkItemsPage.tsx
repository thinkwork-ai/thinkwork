import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Button, cn } from "@thinkwork/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  CreateWorkItemDocumentMutation,
  CreateWorkItemMutation,
  SpacesQuery,
  UpdateWorkItemDocumentMutation,
  UpdateWorkItemMutation,
  UpdateWorkItemStatusMutation,
  WorkItemDocumentsQuery,
  WorkItemLabelsQuery,
  WorkItemStatusesQuery,
  WorkItemsQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import {
  WORK_ITEM_PRIORITY_ORDER,
  buildWorkItemSequenceNumbers,
  categoryStatuses,
  isWorkItemDueSoon,
  isWorkItemOpen,
  sortWorkItemStatuses,
  type WorkItemAssigneeSummary,
  type WorkItemDocumentKind,
  type WorkItemDocumentSummary,
  type WorkItemLabelSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  type WorkItemPriority,
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
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";
import { WorkItemsBoardView } from "./WorkItemsBoardView";
import { WorkItemsListView } from "./WorkItemsListView";

interface WorkItemsResult {
  workItems?: WorkItemSummary[] | null;
}

interface WorkItemStatusesResult {
  workItemStatuses?: WorkItemStatusSummary[] | null;
}

interface WorkItemLabelsResult {
  workItemLabels?: WorkItemLabelSummary[] | null;
}

interface WorkItemDocumentsResult {
  workItemDocuments?: WorkItemDocumentSummary[] | null;
}

interface SpacesResult {
  spaces?: WorkItemSpaceSummary[] | null;
}

interface TenantMemberSummary {
  principalType: string;
  principalId: string;
  status?: string | null;
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
}

interface TenantMembersResult {
  tenantMembers?: TenantMemberSummary[] | null;
}

interface WorkItemsPageProps {
  tenantId: string | null;
  userId?: string | null;
  state: WorkItemRouteSearch;
  onStateChange: (next: WorkItemRouteSearch) => void;
  onItemOpen?: (item: WorkItemSummary) => void;
}

export function WorkItemsPage({
  tenantId,
  userId,
  state,
  onStateChange,
  onItemOpen,
}: WorkItemsPageProps) {
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [newWorkItemOpen, setNewWorkItemOpen] = useState(false);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [showDoneItems, setShowDoneItems] = useState(false);
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
  const [{ data: labelsData }] = useQuery<WorkItemLabelsResult>({
    query: WorkItemLabelsQuery,
    variables: { input: { tenantId: tenantId ?? "", limit: 200 } },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: membersData }] = useQuery<TenantMembersResult>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: documentsData, fetching: documentsFetching },
    reexecuteDocuments,
  ] = useQuery<WorkItemDocumentsResult>({
    query: WorkItemDocumentsQuery,
    variables: {
      input: {
        tenantId: tenantId ?? "",
        workItemId: detailItemId ?? "",
        includeContent: true,
        limit: 50,
      },
    },
    pause: !tenantId || !detailItemId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: statusUpdating }, executeStatusUpdate] = useMutation(
    UpdateWorkItemStatusMutation,
  );
  const [{ fetching: workItemUpdating }, executeWorkItemUpdate] = useMutation(
    UpdateWorkItemMutation,
  );
  const [{ fetching: creatingWorkItem }, executeCreateWorkItem] = useMutation(
    CreateWorkItemMutation,
  );
  const [{ fetching: documentCreating }, executeCreateDocument] = useMutation(
    CreateWorkItemDocumentMutation,
  );
  const [{ fetching: documentUpdating }, executeUpdateDocument] = useMutation(
    UpdateWorkItemDocumentMutation,
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
  const labels = labelsData?.workItemLabels ?? [];
  const workItems = data?.workItems ?? [];
  const sequenceNumbers = useMemo(
    () => buildWorkItemSequenceNumbers(workItems),
    [workItems],
  );
  const assignees = useMemo(
    () => workItemAssigneesFromMembers(membersData?.tenantMembers ?? []),
    [membersData?.tenantMembers],
  );
  const detailItem = workItems.find((item) => item.id === detailItemId) ?? null;
  const detailDocuments = documentsData?.workItemDocuments ?? [];
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
      reexecuteItems({ requestPolicy: "network-only" });
    },
    [executeStatusUpdate, reexecuteItems, statusUpdating, tenantId],
  );

  const handleWorkItemUpdate = useCallback(
    async (
      item: WorkItemSummary,
      patch: {
        priority?: WorkItemPriority;
        dueAt?: string | null;
        ownerUserId?: string | null;
        labelIds?: string[];
      },
    ) => {
      if (!tenantId || workItemUpdating) return;
      setUpdatingItemId(item.id);
      const result = await executeWorkItemUpdate({
        input: {
          tenantId,
          workItemId: item.id,
          ...patch,
        },
      });
      setUpdatingItemId(null);
      if (result.error) {
        toast.error(`Couldn't update Work Item: ${result.error.message}`);
        return;
      }
      reexecuteItems({ requestPolicy: "network-only" });
    },
    [executeWorkItemUpdate, reexecuteItems, tenantId, workItemUpdating],
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

  const handleCreateDocument = useCallback(
    async (input: {
      title: string;
      kind: WorkItemDocumentKind;
      content?: string;
      contentBase64?: string;
      contentType?: string;
      filename?: string;
    }) => {
      if (!tenantId || !detailItemId || documentCreating) return false;
      const result = await executeCreateDocument({
        input: {
          tenantId,
          workItemId: detailItemId,
          title: input.title,
          kind: input.kind,
          content: input.content,
          contentBase64: input.contentBase64,
          contentType: input.contentType ?? "text/markdown",
          filename: input.filename,
        },
      });
      if (result.error) {
        toast.error(`Couldn't create document: ${result.error.message}`);
        return false;
      }
      toast.success("Document added");
      reexecuteDocuments({ requestPolicy: "network-only" });
      return true;
    },
    [
      detailItemId,
      documentCreating,
      executeCreateDocument,
      reexecuteDocuments,
      tenantId,
    ],
  );

  const handleArchiveDocument = useCallback(
    async (document: WorkItemDocumentSummary) => {
      if (!tenantId || documentUpdating) return;
      const result = await executeUpdateDocument({
        input: {
          tenantId,
          id: document.id,
          archived: true,
        },
      });
      if (result.error) {
        toast.error(`Couldn't archive document: ${result.error.message}`);
        return;
      }
      toast.success("Document archived");
      reexecuteDocuments({ requestPolicy: "network-only" });
    },
    [documentUpdating, executeUpdateDocument, reexecuteDocuments, tenantId],
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
    actionKey: `work-items:${showDoneItems ? "done-visible" : "done-hidden"}:${JSON.stringify(state)}`,
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
        {state.view === "list" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 text-muted-foreground hover:text-foreground",
              showDoneItems && "text-white hover:text-white [&_svg]:text-white",
            )}
            aria-label={
              showDoneItems ? "Hide Done Work Items" : "Show Done Work Items"
            }
            aria-pressed={showDoneItems}
            title="Done"
            onClick={() => setShowDoneItems((current) => !current)}
          >
            <CircleCheck className="size-4" />
          </Button>
        ) : null}
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
              assignees={assignees}
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
              showDoneItems={showDoneItems}
              updatingItemId={updatingItemId}
              assignees={assignees}
              labels={labels}
              currentUserId={userId}
              sequenceNumbers={sequenceNumbers}
              onStatusChange={handleStatusChange}
              onItemUpdate={handleWorkItemUpdate}
              onItemOpen={(item) =>
                onItemOpen ? onItemOpen(item) : setDetailItemId(item.id)
              }
            />
          )}
        </div>
      </div>
      <NewWorkItemSheet
        open={newWorkItemOpen}
        spaces={spaces}
        labels={labels}
        defaultSpaceId={state.spaceId}
        saving={creatingWorkItem}
        onOpenChange={setNewWorkItemOpen}
        onCreate={handleCreateWorkItem}
      />
      <WorkItemDetailSheet
        item={detailItem}
        sequenceNumber={
          detailItem ? sequenceNumbers.get(detailItem.id) : undefined
        }
        spaces={spaces}
        labels={labels}
        statuses={statuses}
        assignees={assignees}
        documents={detailDocuments}
        documentsLoading={documentsFetching}
        documentSaving={documentCreating || documentUpdating}
        updating={Boolean(detailItem && updatingItemId === detailItem.id)}
        open={Boolean(detailItemId)}
        onOpenChange={(open) => {
          if (!open) setDetailItemId(null);
        }}
        onStatusChange={handleStatusChange}
        onItemUpdate={handleWorkItemUpdate}
        onDocumentCreate={handleCreateDocument}
        onDocumentArchive={handleArchiveDocument}
      />
    </main>
  );
}

function workItemAssigneesFromMembers(
  members: TenantMemberSummary[],
): WorkItemAssigneeSummary[] {
  return members
    .filter(
      (member) =>
        member.principalType?.toUpperCase() === "USER" &&
        member.status?.toLowerCase() !== "removed",
    )
    .map((member) => {
      const name = member.user?.name?.trim();
      const email = member.user?.email?.trim();
      return {
        id: member.user?.id ?? member.principalId,
        name: name || email || member.principalId,
        email,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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
