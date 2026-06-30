import type React from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconAlertTriangle,
  IconCalendarClock,
  IconCircleCheck,
  IconCircleDashed,
  IconEdit,
  IconFileText,
  IconFlag,
  IconLink,
  IconLockOpen,
  IconMessageCircle,
  IconRobot,
  IconTag,
  IconUserPlus,
} from "@tabler/icons-react";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  Info,
  Link2,
  LockOpen,
  MessageSquareText,
  MoreHorizontal,
  PauseCircle,
  PencilLine,
  Tag,
  UserPlus,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@thinkwork/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Response } from "@/components/ai-elements/response";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  RecordOpenEngineHumanActionMutation,
  SpacesQuery,
  CreateWorkItemCommentMutation,
  UpdateWorkItemMutation,
  UpdateWorkItemStatusMutation,
  WorkItemDocumentQuery,
  WorkItemDocumentsQuery,
  WorkItemCommentsQuery,
  WorkItemLabelsQuery,
  WorkItemQuery,
  WorkItemStatusesQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import type {
  WorkItemAssigneeSummary,
  WorkItemCommentSummary,
  WorkItemDocumentSummary,
  WorkItemEventSummary,
  WorkItemLabelSummary,
  WorkItemPriority,
  WorkItemSpaceSummary,
  WorkItemStatusSummary,
  WorkItemSummary,
} from "./work-item-display";
import {
  categoryStatuses,
  sortWorkItemStatuses,
  workItemAssigneeLabel,
  workItemPriorityLabel,
  workItemSpaceLabel,
  workItemStatusCategoryLabel,
} from "./work-item-display";
import {
  DEFAULT_WORK_ITEM_SEARCH,
  workItemRouteSearchToParams,
} from "./work-item-filters";
import {
  describeWorkItemActivity,
  isWorkItemActivityTimelineEvent,
  type WorkItemActivityDescriptor,
  type WorkItemActivityIconKey,
  type WorkItemActivityTone,
} from "./work-item-activity";

interface WorkItemResult {
  workItem?: WorkItemSummary | null;
}

interface WorkItemDocumentsResult {
  workItemDocuments?: WorkItemDocumentSummary[] | null;
}

interface WorkItemDocumentResult {
  workItemDocument?: WorkItemDocumentSummary | null;
}

interface WorkItemCommentsResult {
  workItemComments?: WorkItemCommentSummary[] | null;
}

interface SpacesResult {
  spaces?: WorkItemSpaceSummary[] | null;
}

interface WorkItemStatusesResult {
  workItemStatuses?: WorkItemStatusSummary[] | null;
}

interface WorkItemLabelsResult {
  workItemLabels?: WorkItemLabelSummary[] | null;
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

type OpenEngineHumanActionType =
  | "ANSWER_BLOCKER"
  | "RELEASE_HOLD"
  | "REQUEST_REVIEW"
  | "MARK_REVIEWED"
  | "MARK_BLOCKED"
  | "MARK_FAILED";

type WorkItemActivityItem =
  | {
      kind: "comment";
      id: string;
      createdAt?: string | null;
      comment: WorkItemCommentSummary;
    }
  | {
      kind: "event";
      id: string;
      createdAt?: string | null;
      event: WorkItemEventSummary;
    };

export function WorkItemDetailPage({
  tenantId,
  workItemId,
}: {
  tenantId: string | null;
  workItemId: string;
}) {
  const [{ data, fetching, error }, reexecuteWorkItem] =
    useQuery<WorkItemResult>({
      query: WorkItemQuery,
      variables: { tenantId: tenantId ?? undefined, id: workItemId },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  const [{ data: documentsData, fetching: documentsFetching }] =
    useQuery<WorkItemDocumentsResult>({
      query: WorkItemDocumentsQuery,
      variables: {
        input: {
          tenantId: tenantId ?? "",
          workItemId,
          includeContent: true,
          limit: 50,
        },
      },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  const [{ data: commentsData, error: commentsError }, reexecuteComments] =
    useQuery<WorkItemCommentsResult>({
      query: WorkItemCommentsQuery,
      variables: {
        input: {
          tenantId: tenantId ?? "",
          workItemId,
          limit: 100,
        },
      },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  const [{ data: spacesData }] = useQuery<SpacesResult>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: membersData }] = useQuery<TenantMembersResult>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const item = data?.workItem ?? null;
  const [{ data: statusesData }] = useQuery<WorkItemStatusesResult>({
    query: WorkItemStatusesQuery,
    variables: { tenantId: tenantId ?? "", spaceId: item?.spaceId ?? "" },
    pause: !tenantId || !item?.spaceId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: labelsData }] = useQuery<WorkItemLabelsResult>({
    query: WorkItemLabelsQuery,
    variables: { input: { tenantId: tenantId ?? "", limit: 200 } },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: workItemSaving }, executeWorkItemUpdate] = useMutation(
    UpdateWorkItemMutation,
  );
  const [{ fetching: statusSaving }, executeStatusUpdate] = useMutation(
    UpdateWorkItemStatusMutation,
  );
  const [{ fetching: humanActionSaving }, executeHumanAction] = useMutation(
    RecordOpenEngineHumanActionMutation,
  );
  const [{ fetching: commentSaving }, executeCreateComment] = useMutation(
    CreateWorkItemCommentMutation,
  );
  const [humanActionError, setHumanActionError] = useState<string | null>(null);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);

  const itemKey = item ? workItemKey(item) : "Work Item";
  usePageHeaderActions({
    title: item?.title ?? "Work Item",
    documentTitle: item ? `${itemKey} ${item.title}` : "Work Item",
    breadcrumbs: [
      {
        label: "Work Items",
        href: "/work-items",
        search: workItemRouteSearchToParams(DEFAULT_WORK_ITEM_SEARCH) as Record<
          string,
          unknown
        >,
      },
      { label: item ? `${itemKey} ${item.title}` : "Work Item" },
    ],
    action: item ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-foreground lg:hidden"
        aria-label="Show Work Item details"
        title="Show Work Item details"
        onClick={() => setDetailsSheetOpen(true)}
      >
        <Info className="size-4" />
      </Button>
    ) : undefined,
    actionKey: item ? `work-item-detail-actions:${item.id}` : undefined,
  });

  if (!tenantId || (fetching && !data)) return <PageSkeleton />;

  if (error) {
    return (
      <main className="flex h-full w-full flex-col bg-background p-6">
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {error.message}
        </div>
      </main>
    );
  }
  if (!item) {
    return (
      <main className="flex h-full w-full flex-col bg-background p-6">
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          This Work Item could not be found.
        </div>
      </main>
    );
  }

  const spaces = spacesData?.spaces ?? [];
  const assignees = workItemAssigneesFromMembers(
    membersData?.tenantMembers ?? [],
  );
  const statuses = sortWorkItemStatuses(statusesData?.workItemStatuses ?? []);
  const statusOptions = statuses.length > 0 ? statuses : categoryStatuses();
  const labels = labelsData?.workItemLabels ?? [];
  const documents = documentsData?.workItemDocuments ?? [];
  const events = [...(item.events ?? [])].filter(
    (event) =>
      normalizeEventType(event.eventType) !== "comment_added" &&
      !isMirroredOpenEngineReceiptEvent(event),
  );
  const comments = commentsData?.workItemComments ?? item.comments ?? [];
  const activityItems = buildActivityItems(comments, events);
  const handleCreateComment = async (body: string) => {
    if (!tenantId || commentSaving || commentsError) return false;
    const result = await executeCreateComment({
      input: {
        tenantId,
        workItemId: item.id,
        body,
      },
    });
    if (result.error) {
      toast.error(`Couldn't add comment: ${result.error.message}`);
      return false;
    }
    reexecuteWorkItem({ requestPolicy: "network-only" });
    reexecuteComments({ requestPolicy: "network-only" });
    return true;
  };
  const sortedEvents = [...events].sort(
    (left, right) => dateTime(right.createdAt) - dateTime(left.createdAt),
  );
  const handleWorkItemUpdate = async (patch: {
    priority?: WorkItemPriority;
    ownerUserId?: string | null;
    labelIds?: string[];
    openEngineQueueKey?: string | null;
  }) => {
    if (!tenantId || workItemSaving) return false;
    const result = await executeWorkItemUpdate({
      input: {
        tenantId,
        workItemId: item.id,
        ...patch,
      },
    });
    if (result.error) {
      toast.error(`Couldn't update Work Item: ${result.error.message}`);
      return false;
    }
    reexecuteWorkItem({ requestPolicy: "network-only" });
    return true;
  };
  const handleStatusChange = async (statusId: string) => {
    const nextStatus = statusOptions.find((status) => status.id === statusId);
    if (!tenantId || !nextStatus || statusSaving) return false;
    const result = await executeStatusUpdate({
      input: {
        tenantId,
        workItemId: item.id,
        statusId: nextStatus.spaceId ? nextStatus.id : undefined,
        statusCategory: nextStatus.spaceId ? undefined : nextStatus.category,
      },
    });
    if (result.error) {
      toast.error(`Couldn't update status: ${result.error.message}`);
      return false;
    }
    reexecuteWorkItem({ requestPolicy: "network-only" });
    return true;
  };
  const handleOpenEngineHumanAction = async (
    actionType: OpenEngineHumanActionType,
    message: string,
  ) => {
    if (!tenantId || !item) return false;
    setHumanActionError(null);
    const result = await executeHumanAction({
      input: {
        tenantId,
        workItemId: item.id,
        actionType,
        message: message.trim() || undefined,
        idempotencyKey: `open-engine-human:${item.id}:${actionType}:${Date.now()}`,
      },
    });
    if (result.error) {
      setHumanActionError(formatOpenEngineActionError(result.error.message));
      return false;
    }
    reexecuteWorkItem({ requestPolicy: "network-only" });
    return true;
  };

  return (
    <main className="h-full w-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-6 py-6">
        <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-6">
            <section className="space-y-4">
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                {item.title}
              </h1>
              <MarkdownPanel
                content={item.notes}
                empty="No description has been added yet."
              />
            </section>

            <ResourcesSection
              item={item}
              documents={documents}
              loading={documentsFetching}
            />

            <ActivitySection
              item={item}
              activityItems={activityItems}
              assignees={assignees}
              statuses={statusOptions}
              commentSaving={commentSaving}
              commentsUnavailable={Boolean(commentsError)}
              onCreateComment={handleCreateComment}
              onRefresh={reexecuteWorkItem}
            />
          </div>

          <aside className="hidden space-y-3 lg:sticky lg:top-5 lg:block lg:self-start">
            <WorkItemDetailRail
              presentation="cards"
              item={item}
              spaces={spaces}
              assignees={assignees}
              labels={labels}
              statusOptions={statusOptions}
              events={sortedEvents}
              documents={documents}
              statusSaving={statusSaving}
              workItemSaving={workItemSaving}
              saving={humanActionSaving}
              error={humanActionError}
              onStatusChange={handleStatusChange}
              onWorkItemUpdate={handleWorkItemUpdate}
              onAction={handleOpenEngineHumanAction}
            />
          </aside>
        </div>
      </div>

      {detailsSheetOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/10"
          role="presentation"
          onClick={() => setDetailsSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Work Item details"
            data-testid="work-item-details-floating-panel"
            className="fixed right-3 top-16 w-[259px] animate-in slide-in-from-right-10 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close Work Item details"
              title="Close Work Item details"
              onClick={() => setDetailsSheetOpen(false)}
            >
              <X className="size-4" />
            </button>
            <WorkItemDetailRail
              presentation="single"
              item={item}
              spaces={spaces}
              assignees={assignees}
              labels={labels}
              statusOptions={statusOptions}
              events={sortedEvents}
              documents={documents}
              statusSaving={statusSaving}
              workItemSaving={workItemSaving}
              saving={humanActionSaving}
              error={humanActionError}
              onStatusChange={handleStatusChange}
              onWorkItemUpdate={handleWorkItemUpdate}
              onAction={handleOpenEngineHumanAction}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function WorkItemDetailRail({
  presentation,
  item,
  spaces,
  assignees,
  labels,
  statusOptions,
  events,
  documents,
  statusSaving,
  workItemSaving,
  saving,
  error,
  onStatusChange,
  onWorkItemUpdate,
  onAction,
}: {
  presentation: "cards" | "single";
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  assignees: WorkItemAssigneeSummary[];
  labels: WorkItemLabelSummary[];
  statusOptions: WorkItemStatusSummary[];
  events: WorkItemEventSummary[];
  documents: WorkItemDocumentSummary[];
  statusSaving: boolean;
  workItemSaving: boolean;
  saving: boolean;
  error: string | null;
  onStatusChange: (statusId: string) => Promise<boolean>;
  onWorkItemUpdate: (patch: {
    priority?: WorkItemPriority;
    ownerUserId?: string | null;
    labelIds?: string[];
    openEngineQueueKey?: string | null;
  }) => Promise<boolean>;
  onAction: (
    actionType: OpenEngineHumanActionType,
    message: string,
  ) => Promise<boolean>;
}) {
  const sectionVariant = presentation === "single" ? "separator" : "card";
  const content = (
    <>
      <RailSection title="Properties" variant={sectionVariant}>
        <EditablePropertyRow
          icon={<CircleDot className="size-4" />}
          label="Status"
          value={
            item.statusId ??
            statusOptions.find(
              (status) => status.category === item.status?.category,
            )?.id ??
            ""
          }
          options={statusOptions.map((status) => ({
            value: status.id,
            label: status.name ?? workItemStatusCategoryLabel(status.category),
            color: status.color,
          }))}
          disabled={statusSaving}
          onChange={onStatusChange}
        />
        <EditablePropertyRow
          icon={<GitBranch className="size-4" />}
          label="Priority"
          value={item.priority}
          options={WORK_ITEM_PRIORITY_OPTIONS}
          disabled={workItemSaving}
          onChange={(priority) =>
            onWorkItemUpdate({
              priority: priority as WorkItemPriority,
            })
          }
        />
        <EditablePropertyRow
          icon={<UserRound className="size-4" />}
          label="Assignee"
          value={item.ownerUserId ?? ""}
          options={[
            { value: "", label: "Unassigned" },
            ...assignees.map((assignee) => ({
              value: assignee.id,
              label: assignee.name,
            })),
          ]}
          disabled={workItemSaving}
          onChange={(ownerUserId) =>
            onWorkItemUpdate({
              ownerUserId: ownerUserId || null,
            })
          }
        />
        <PropertyRow
          icon={<Link2 className="size-4" />}
          label="Space"
          value={workItemSpaceLabel(item.spaceId, spaces)}
        />
        <PropertyRow
          icon={<CalendarDays className="size-4" />}
          label="Created"
          value={formatDate(item.createdAt)}
        />
        <PropertyRow
          icon={<CalendarDays className="size-4" />}
          label="Updated"
          value={formatDate(item.updatedAt)}
        />
      </RailSection>

      <LabelsRailSection
        variant={sectionVariant}
        item={item}
        labels={labels}
        disabled={workItemSaving}
        onChange={(labelIds) => onWorkItemUpdate({ labelIds })}
      />

      <OpenEngineRailSection
        variant={sectionVariant}
        item={item}
        events={events}
        documents={documents}
        saving={saving}
        queueSaving={workItemSaving}
        error={error}
        onQueueChange={(openEngineQueueKey) =>
          onWorkItemUpdate({ openEngineQueueKey })
        }
        onAction={onAction}
      />
    </>
  );

  if (presentation === "cards") return content;

  return (
    <div className="w-[259px] rounded-md border bg-background p-3 shadow-lg">
      {content}
    </div>
  );
}

export function WorkItemDocumentPage({
  tenantId,
  workItemId,
  documentId,
}: {
  tenantId: string | null;
  workItemId: string;
  documentId: string;
}) {
  const [{ data: itemData, fetching: itemFetching, error: itemError }] =
    useQuery<WorkItemResult>({
      query: WorkItemQuery,
      variables: { tenantId: tenantId ?? undefined, id: workItemId },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  const [
    { data: documentData, fetching: documentFetching, error: documentError },
  ] = useQuery<WorkItemDocumentResult>({
    query: WorkItemDocumentQuery,
    variables: {
      input: {
        tenantId: tenantId ?? "",
        id: documentId,
      },
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const item = itemData?.workItem ?? null;
  const document = documentData?.workItemDocument ?? null;
  const itemKey = item ? workItemKey(item) : "Work Item";

  usePageHeaderActions({
    title: document?.title ?? "Document",
    documentTitle: document
      ? `${document.title} · ${itemKey}`
      : "Work Item Document",
    breadcrumbs: [
      {
        label: "Work Items",
        href: "/work-items",
        search: workItemRouteSearchToParams(DEFAULT_WORK_ITEM_SEARCH) as Record<
          string,
          unknown
        >,
      },
      {
        label: itemKey,
        href: `/work-items/${workItemId}`,
      },
      { label: document?.title ?? "Document" },
    ],
  });

  if (
    !tenantId ||
    ((itemFetching || documentFetching) && (!item || !document))
  ) {
    return <PageSkeleton />;
  }

  const error = itemError ?? documentError;
  if (error) {
    return (
      <main className="flex h-full w-full flex-col bg-background p-6">
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {error.message}
        </div>
      </main>
    );
  }

  if (!item || !document) {
    return (
      <main className="flex h-full w-full flex-col bg-background p-6">
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          This Work Item document could not be found.
        </div>
      </main>
    );
  }

  return (
    <main className="h-full w-full overflow-auto bg-background">
      <article className="mx-auto flex w-full max-w-[980px] flex-col gap-6 px-6 py-8">
        <header className="space-y-4">
          <div className="flex size-10 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground dark:bg-muted/30">
            <FileText className="size-5" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              {document.title}
            </h1>
            <p className="text-xs text-muted-foreground">
              {document.kind.toLowerCase()} · {document.contentType} ·{" "}
              {formatBytes(document.sizeBytes)} · Updated{" "}
              {formatDate(document.updatedAt ?? document.createdAt)}
            </p>
          </div>
        </header>

        <DocumentViewer document={document} />
      </article>
    </main>
  );
}

function MarkdownPanel({
  content,
  empty,
}: {
  content?: string | null;
  empty: string;
}) {
  if (!content?.trim()) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <Response className="prose-invert text-sm leading-6 text-foreground prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold">
      {content}
    </Response>
  );
}

function DocumentViewer({ document }: { document: WorkItemDocumentSummary }) {
  if (!document.content?.trim()) {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-6 text-sm text-muted-foreground dark:bg-muted/30">
        Preview unavailable for this document.
      </div>
    );
  }

  if (document.contentType.toLowerCase() === "application/json") {
    return (
      <pre className="overflow-auto rounded-md border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground dark:bg-muted/30">
        {document.content}
      </pre>
    );
  }

  return (
    <Response className="prose-invert max-w-none text-base leading-7 text-foreground prose-headings:mb-3 prose-headings:mt-8 prose-headings:font-semibold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:my-4 prose-p:leading-7 prose-ul:my-4 prose-ol:my-4 prose-li:my-1 prose-li:leading-7 prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-hr:my-8">
      {document.content}
    </Response>
  );
}

function ResourcesSection({
  item,
  documents,
  loading,
}: {
  item: WorkItemSummary;
  documents: WorkItemDocumentSummary[];
  loading: boolean;
}) {
  const threadLinks = item.threadLinks ?? [];
  const externalRefs = (item.externalRefs ?? []).filter((ref) =>
    Boolean(ref.externalUrl),
  );
  const count = documents.length + threadLinks.length + externalRefs.length;
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="space-y-3">
      <button
        type="button"
        className="flex items-center gap-2 text-left text-sm font-semibold text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <span>Resources</span>
        <span className="text-xs font-medium text-muted-foreground">
          {loading ? "Loading" : count}
        </span>
      </button>
      {expanded ? (
        count === 0 ? (
          <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
            No resources attached yet.
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => (
              <DocumentResourceRow
                key={document.id}
                document={document}
                workItemId={item.id}
              />
            ))}
            {threadLinks.map((link) => (
              <Link
                key={link.id ?? link.threadId}
                to="/threads/$id"
                params={{ id: link.threadId }}
                className={resourceRowClassName}
              >
                <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
                <ResourceText
                  title={`Thread ${link.relationship ?? ""}`.trim()}
                />
                <ResourceDate value={link.createdAt} fallback="Thread" />
                <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            {externalRefs.map((ref) => (
              <a
                key={ref.id ?? `${ref.provider}-${ref.externalId}`}
                href={ref.externalUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className={resourceRowClassName}
              >
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                <ResourceText title={externalRefTitle(ref)} />
                <span className="shrink-0 text-xs text-muted-foreground">
                  External
                </span>
                <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

const resourceRowClassName = cn(
  "flex min-h-12 items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 dark:bg-muted/40",
  "text-left transition-colors hover:bg-muted/50 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

function DocumentResourceRow({
  document,
  workItemId,
}: {
  document: WorkItemDocumentSummary;
  workItemId: string;
}) {
  return (
    <Link
      to="/work-items/$workItemId/documents/$documentId"
      params={{ workItemId, documentId: document.id }}
      className={resourceRowClassName}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <ResourceText title={document.title} />
      <ResourceDate value={document.updatedAt ?? document.createdAt} />
      <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function ResourceText({ title }: { title: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
    </div>
  );
}

function ResourceDate({
  value,
  fallback = "",
}: {
  value?: string | null;
  fallback?: string;
}) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {relativeDate(value) || fallback}
    </span>
  );
}

function ActivitySection({
  item,
  activityItems,
  assignees,
  statuses,
  commentSaving,
  commentsUnavailable,
  onCreateComment,
  onRefresh,
}: {
  item: WorkItemSummary;
  activityItems: WorkItemActivityItem[];
  assignees: WorkItemAssigneeSummary[];
  statuses: WorkItemStatusSummary[];
  commentSaving: boolean;
  commentsUnavailable: boolean;
  onCreateComment: (body: string) => Promise<boolean>;
  onRefresh: (opts?: { requestPolicy?: "network-only" }) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const submitComment = async () => {
    const body = commentBody.trim();
    if (!body || commentSaving || commentsUnavailable) return;
    const created = await onCreateComment(body);
    if (created) setCommentBody("");
  };

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex items-center gap-2 text-left text-sm font-semibold text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              !expanded && "-rotate-90",
            )}
          />
          <span>Activity</span>
          <span className="text-xs font-medium text-muted-foreground">
            {activityItems.length}
          </span>
        </button>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onRefresh({ requestPolicy: "network-only" })}
        >
          Refresh activity
        </button>
      </div>
      {!expanded ? null : (
        <>
          {activityItems.length === 0 ? (
            <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : (
            <ol>
              {activityItems.map((activityItem, index) =>
                activityItem.kind === "comment" ? (
                  <ActivityCommentRow
                    key={`comment:${activityItem.id}`}
                    comment={activityItem.comment}
                    assignees={assignees}
                  />
                ) : (
                  <ActivityEventRow
                    key={`event:${activityItem.id}`}
                    item={item}
                    event={activityItem.event}
                    assignees={assignees}
                    statuses={statuses}
                    showConnector={hasFollowingTimelineEvent(
                      activityItems,
                      index,
                    )}
                  />
                ),
              )}
            </ol>
          )}
          <div className="space-y-3">
            <Textarea
              value={commentBody}
              rows={3}
              placeholder="Leave a comment..."
              disabled={commentSaving || commentsUnavailable}
              title={
                commentsUnavailable
                  ? "Work Item comments are waiting for the API deployment."
                  : undefined
              }
              onChange={(event) => setCommentBody(event.target.value)}
              className="min-h-20 resize-y bg-background/35 px-3 py-2 shadow-none focus-visible:ring-1"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={
                  !commentBody.trim() || commentSaving || commentsUnavailable
                }
                onClick={submitComment}
              >
                Comment
              </Button>
            </div>
            {commentsUnavailable ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Comments are waiting for the Work Item comments API deployment.
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ActivityCommentRow({
  comment,
  assignees,
}: {
  comment: WorkItemCommentSummary;
  assignees: WorkItemAssigneeSummary[];
}) {
  return (
    <li className="mt-3 first:mt-0">
      <article className="rounded-md border bg-muted/40 p-4 dark:bg-muted/40">
        <header className="flex min-w-0 items-center gap-1.5">
          <ActivityInlineIcon
            icon={IconMessageCircle}
            className="text-blue-600 dark:text-blue-300"
          />
          <span className="truncate text-xs font-semibold text-foreground">
            {commentAuthor(comment, assignees)}
          </span>
          <span className="text-xs text-muted-foreground">commented</span>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={absoluteDateTime(comment.createdAt)}
          >
            {activityTimestamp(comment.createdAt)}
          </span>
        </header>
        <ActivityMarkdown content={comment.body} empty="No comment body." />
      </article>
    </li>
  );
}

function ActivityEventRow({
  item,
  event,
  assignees,
  statuses,
  showConnector,
}: {
  item: WorkItemSummary;
  event: WorkItemEventSummary;
  assignees: WorkItemAssigneeSummary[];
  statuses: WorkItemStatusSummary[];
  showConnector: boolean;
}) {
  const descriptor = describeWorkItemActivity({
    event,
    item,
    assignees,
    statuses,
  });

  return descriptor.displayMode === "compact" ? (
    <li className="grid min-h-8 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2">
      <span className="relative flex h-8 items-center justify-center">
        {showConnector ? (
          <span className="absolute left-1/2 top-1/2 h-8 w-px -translate-x-1/2 bg-border" />
        ) : null}
        <ActivityEventIcon descriptor={descriptor} />
      </span>
      <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground">
          {descriptor.actorLabel}
        </span>
        <span className="min-w-0 truncate">{descriptor.actionText}</span>
      </p>
      <time
        dateTime={event.createdAt ?? undefined}
        title={absoluteDateTime(event.createdAt)}
        className="shrink-0 text-xs text-muted-foreground"
      >
        {activityTimestamp(event.createdAt)}
      </time>
    </li>
  ) : (
    <li>
      <article className="rounded-md border bg-muted/40 p-4 dark:bg-muted/40">
        <header className="flex min-w-0 items-center gap-1.5">
          <ActivityEventIcon descriptor={descriptor} />
          <span className="truncate text-xs font-semibold text-foreground">
            {descriptor.actorLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {descriptor.actionText.toLowerCase()}
          </span>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={absoluteDateTime(event.createdAt)}
          >
            {activityTimestamp(event.createdAt)}
          </span>
        </header>
        <ActivityMarkdown
          content={event.message}
          empty="No message recorded."
        />
      </article>
    </li>
  );
}

function ActivityEventIcon({
  descriptor,
}: {
  descriptor: WorkItemActivityDescriptor;
}) {
  const Icon = activityIcon(descriptor.iconKey);
  return (
    <ActivityInlineIcon
      icon={Icon}
      className={activityIconTone(descriptor.tone)}
    />
  );
}

function ActivityInlineIcon({
  icon: Icon,
  className,
}: {
  icon: React.ComponentType<{ className?: string; stroke?: number }>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-5 shrink-0 items-center justify-center bg-background",
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-4" stroke={2} />
    </span>
  );
}

function activityIcon(iconKey: WorkItemActivityIconKey) {
  switch (iconKey) {
    case "agent":
      return IconRobot;
    case "applicability":
      return IconCircleDashed;
    case "assigned":
      return IconUserPlus;
    case "blocked":
      return IconAlertTriangle;
    case "completed":
      return IconCircleCheck;
    case "created":
      return IconEdit;
    case "document":
      return IconFileText;
    case "due_date":
      return IconCalendarClock;
    case "labels":
      return IconTag;
    case "linked":
      return IconLink;
    case "priority":
      return IconFlag;
    case "status":
      return IconCircleDashed;
    case "unblocked":
      return IconLockOpen;
    case "updated":
    default:
      return IconEdit;
  }
}

function activityIconTone(tone: WorkItemActivityTone) {
  switch (tone) {
    case "amber":
      return "border-amber-500/30 text-amber-600 dark:text-amber-300";
    case "blue":
      return "border-blue-500/30 text-blue-600 dark:text-blue-300";
    case "emerald":
      return "border-emerald-500/30 text-emerald-600 dark:text-emerald-300";
    case "red":
      return "border-red-500/30 text-red-600 dark:text-red-300";
    case "violet":
      return "border-violet-500/30 text-violet-600 dark:text-violet-300";
    case "slate":
    default:
      return "border-border text-muted-foreground";
  }
}

function ActivityMarkdown({
  content,
  empty,
}: {
  content?: string | null;
  empty: string;
}) {
  if (!content?.trim()) {
    return <p className="mt-3 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="mt-3">
      <Response className="prose-invert text-sm leading-6 text-foreground prose-p:my-2 prose-p:leading-6 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-6 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold">
        {content}
      </Response>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {detail ? (
        <span className="text-xs font-medium text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

function RailSection({
  title,
  children,
  variant = "card",
}: {
  title: string;
  children: React.ReactNode;
  variant?: "card" | "separator";
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section
      className={cn(
        variant === "card"
          ? "rounded-md border bg-muted/35 p-3 dark:bg-muted/35"
          : "mt-4 border-t border-border/70 pt-4 first:mt-0 first:border-t-0 first:pt-0",
      )}
    >
      <button
        type="button"
        className="mb-3 flex w-full items-center gap-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <span>{title}</span>
      </button>
      {expanded ? <div className="space-y-2">{children}</div> : null}
    </section>
  );
}

function PropertyRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[1rem_4.25rem_minmax(0,1fr)] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

const WORK_ITEM_PRIORITY_OPTIONS = [
  { value: "URGENT", label: "Urgent", color: "#ef4444" },
  { value: "HIGH", label: "High", color: "#f97316" },
  { value: "NORMAL", label: "Normal", color: "#3b82f6" },
  { value: "LOW", label: "Low", color: "#64748b" },
];

const OPEN_ENGINE_QUEUE_OPTIONS = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "thinkwork-agent", label: "ThinkWork Agent" },
  { value: "human", label: "Human" },
];

interface RailBadgeOption {
  value: string;
  label: string;
  description?: string;
  color?: string | null;
  icon?: React.ReactNode;
}

function EditablePropertyRow({
  icon,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: RailBadgeOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="grid grid-cols-[1rem_4.25rem_minmax(0,1fr)] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <RailBadgeSelector
        value={value}
        displayValue={selected?.label ?? "None"}
        options={options}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function RailBadgeSelector({
  value,
  displayValue,
  options,
  disabled,
  placeholder = "Search...",
  onChange,
}: {
  value: string;
  displayValue: string;
  options: RailBadgeOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      option.label.toLowerCase().includes(query) ||
      option.description?.toLowerCase().includes(query)
    );
  });

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || options.length === 0}
          className="inline-flex h-7 max-w-full min-w-0 items-center justify-between gap-1.5 rounded-full border bg-background/50 px-2 text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selected?.color ? (
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: selected.color }}
              />
            ) : null}
            {selected?.icon ? (
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                {selected.icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{displayValue}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] min-w-44 max-w-64 gap-0 p-0"
      >
        <div className="border-b p-2">
          <Input
            autoFocus
            value={search}
            placeholder={placeholder}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <CheckCircle2
                  className={cn(
                    "size-4 shrink-0 text-primary",
                    value === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
                {option.color ? (
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                ) : null}
                {option.icon ? (
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {option.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          ) : (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              No options found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelPicker({
  labels,
  selectedIds,
  disabled,
  onChange,
  trigger,
}: {
  labels: WorkItemLabelSummary[];
  selectedIds: string[];
  disabled?: boolean;
  onChange: (labelIds: string[]) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draftIds, setDraftIds] = useState(selectedIds);
  const selectedLabels = labels.filter((label) =>
    selectedIds.includes(label.id),
  );
  const filteredLabels = labels.filter((label) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      label.name.toLowerCase().includes(query) ||
      label.slug.toLowerCase().includes(query) ||
      label.description?.toLowerCase().includes(query)
    );
  });
  const selectedDraftLabels = filteredLabels.filter((label) =>
    draftIds.includes(label.id),
  );
  const remainingLabels = filteredLabels.filter(
    (label) => !draftIds.includes(label.id),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraftIds(selectedIds);
        } else if (!disabled && !sameStringSet(draftIds, selectedIds)) {
          onChange(draftIds);
        }
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || labels.length === 0}
          className={cn(
            "inline-flex max-w-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            trigger
              ? "min-h-0 rounded-md p-0 text-foreground hover:opacity-90"
              : "min-h-7 items-center gap-1.5 rounded-full border bg-background/40 px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {trigger ?? "+ Label"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-2rem)] gap-0 p-0"
      >
        <div className="border-b p-2">
          <Input
            autoFocus
            value={search}
            placeholder="Search..."
            onChange={(event) => setSearch(event.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filteredLabels.length ? (
            <>
              {selectedDraftLabels.length > 0 ? (
                <div className="border-b">
                  {selectedDraftLabels.map((label) => (
                    <LabelPickerOption
                      key={label.id}
                      label={label}
                      active
                      onToggle={() =>
                        setDraftIds((current) =>
                          current.filter((id) => id !== label.id),
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}
              <div>
                {remainingLabels.map((label) => (
                  <LabelPickerOption
                    key={label.id}
                    label={label}
                    active={false}
                    onToggle={() =>
                      setDraftIds((current) => [...current, label.id])
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="px-2 py-4 text-sm text-muted-foreground">
              No labels found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelPickerOption({
  label,
  active,
  onToggle,
}: {
  label: WorkItemLabelSummary;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Checkbox
        checked={active}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={onToggle}
        className="size-4 shrink-0"
      />
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: label.color ?? "#64748b" }}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{label.name}</span>
    </div>
  );
}

function LabelsRailSection({
  variant = "card",
  item,
  labels,
  disabled,
  onChange,
}: {
  variant?: "card" | "separator";
  item: WorkItemSummary;
  labels: WorkItemLabelSummary[];
  disabled?: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  const selectedIds = item.labels?.map((label) => label.id) ?? [];
  const selectedLabels = item.labels ?? [];

  return (
    <RailSection title="Labels" variant={variant}>
      {selectedLabels.length ? (
        <LabelPicker
          labels={labels}
          selectedIds={selectedIds}
          disabled={disabled}
          onChange={onChange}
          trigger={
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {selectedLabels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex min-w-0 items-center gap-1 rounded-full border bg-background/45 px-2 py-1 text-xs font-medium text-foreground"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: label.color ?? "#64748b" }}
                  />
                  <span className="max-w-24 truncate">{label.name}</span>
                </span>
              ))}
            </span>
          }
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm text-muted-foreground">No labels</p>
          <LabelPicker
            labels={labels}
            selectedIds={selectedIds}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      )}
    </RailSection>
  );
}

function OpenEngineRailSection({
  variant = "card",
  item,
  events,
  documents,
  saving,
  queueSaving,
  error,
  onQueueChange,
  onAction,
}: {
  variant?: "card" | "separator";
  item: WorkItemSummary;
  events: WorkItemEventSummary[];
  documents: WorkItemDocumentSummary[];
  saving: boolean;
  queueSaving?: boolean;
  error: string | null;
  onQueueChange: (queueKey: string) => void;
  onAction: (
    actionType: OpenEngineHumanActionType,
    message: string,
  ) => Promise<boolean>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ledgerSheetOpen, setLedgerSheetOpen] = useState(false);
  const state = openEngineState(item);
  const latestReceipt = latestOpenEngineEvent(events);
  const latestLedger = latestOpenEngineStatusLedger(documents);
  const needsHumanResponse = Boolean(item.blocked || item.openEngineHumanHold);
  const latestReceiptLabel = latestReceipt
    ? relativeDate(latestReceipt.createdAt)
    : "No receipts yet";

  return (
    <>
      <RailSection title="OpenEngine" variant={variant}>
        <div className="space-y-2 px-1">
          <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-2 text-xs">
            <span className="text-muted-foreground">Queue</span>
            <OpenEngineQueueSelect
              value={item.openEngineQueueKey || "codex"}
              disabled={queueSaving}
              onChange={onQueueChange}
            />
          </div>
          <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-2 text-xs">
            <span className="text-muted-foreground">State</span>
            <button
              type="button"
              title={state.detail}
              onClick={() => setSheetOpen(true)}
              className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-background/50 px-2 text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn("shrink-0 text-muted-foreground", state.tone)}
              >
                {state.icon}
              </span>
              <span className="min-w-0 truncate">{state.label}</span>
            </button>
          </div>
          <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-2 text-xs">
            <span className="text-muted-foreground">Receipt</span>
            <span className="truncate text-foreground">
              {latestReceiptLabel}
            </span>
          </div>
        </div>
      </RailSection>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="space-y-2 pb-2">
            <SheetTitle>OpenEngine</SheetTitle>
            <SheetDescription>
              Queue state and agent receipts for {workItemKey(item)}.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 pb-6 sm:px-6">
            <div className="flex items-center gap-2 rounded-md border bg-muted/35 px-3 py-2 dark:bg-muted/35">
              <span className={cn("text-muted-foreground", state.tone)}>
                {state.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {state.label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {state.detail}
                </p>
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Queue</h3>
              <div className="space-y-2 rounded-md border bg-muted/35 p-3 dark:bg-muted/35">
                <PropertyRow
                  icon={<Bot className="size-4" />}
                  label="Queue"
                  value={item.openEngineQueueKey || "Default"}
                />
                <PropertyRow
                  icon={<Bot className="size-4" />}
                  label="Agent"
                  value={
                    truncateMiddle(item.openEngineClaimedByAgentId) || "None"
                  }
                />
                <PropertyRow
                  icon={<Clock className="size-4" />}
                  label="Claimed"
                  value={relativeDate(item.openEngineClaimedAt) || "None"}
                />
                <PropertyRow
                  icon={<Clock className="size-4" />}
                  label="Lease"
                  value={relativeDate(item.openEngineClaimExpiresAt) || "None"}
                />
              </div>
            </section>

            {item.openEngineHumanHoldReason ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  Hold reason
                </h3>
                <p className="rounded-md border bg-muted/35 p-3 text-sm leading-6 text-muted-foreground dark:bg-muted/35">
                  {item.openEngineHumanHoldReason}
                </p>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">
                Latest receipt
              </h3>
              {latestReceipt ? (
                <div className="rounded-md border bg-muted/35 p-3 dark:bg-muted/35">
                  <p className="text-sm leading-6 text-foreground">
                    {latestReceipt.message ||
                      eventLabel(latestReceipt.eventType)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {relativeDate(latestReceipt.createdAt)}
                  </p>
                </div>
              ) : (
                <p className="rounded-md border bg-muted/35 p-3 text-sm text-muted-foreground dark:bg-muted/35">
                  No OpenEngine receipts yet.
                </p>
              )}
            </section>

            {latestLedger ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  Status ledger
                </h3>
                <button
                  type="button"
                  onClick={() => setLedgerSheetOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md border bg-muted/35 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-muted/35"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {latestLedger.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeDate(
                      latestLedger.updatedAt ?? latestLedger.createdAt,
                    )}
                  </span>
                </button>
              </section>
            ) : null}

            {needsHumanResponse ? (
              <OpenEngineBlockerResolution
                item={item}
                saving={saving}
                error={error}
                onAction={onAction}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {latestLedger ? (
        <Sheet open={ledgerSheetOpen} onOpenChange={setLedgerSheetOpen}>
          <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
            <SheetHeader className="space-y-2 pb-2">
              <SheetTitle>{latestLedger.title}</SheetTitle>
              <SheetDescription>
                {latestLedger.kind.toLowerCase()} · {latestLedger.contentType} ·{" "}
                {formatBytes(latestLedger.sizeBytes)}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6 sm:px-6">
              <DocumentViewer document={latestLedger} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

function OpenEngineQueueSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (queueKey: string) => void;
}) {
  const options = OPEN_ENGINE_QUEUE_OPTIONS.some(
    (option) => option.value === value,
  )
    ? OPEN_ENGINE_QUEUE_OPTIONS
    : [{ value, label: value }, ...OPEN_ENGINE_QUEUE_OPTIONS];
  const selected = options.find((option) => option.value === value);

  return (
    <RailBadgeSelector
      value={value}
      displayValue={selected?.label ?? value}
      options={options.map((option) => ({
        ...option,
        icon: <Bot className="size-3.5" />,
      }))}
      disabled={disabled}
      placeholder="Search queues..."
      onChange={onChange}
    />
  );
}

function OpenEngineBlockerResolution({
  item,
  saving,
  error,
  onAction,
}: {
  item: WorkItemSummary;
  saving: boolean;
  error: string | null;
  onAction: (
    actionType: OpenEngineHumanActionType,
    message: string,
  ) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const submit = async (
    actionType: "ANSWER_BLOCKER" | "RELEASE_HOLD",
    messageOverride?: string,
  ) => {
    const didSave = await onAction(actionType, messageOverride ?? message);
    if (didSave) {
      setMessage("");
    }
  };
  const holdLabel = item.blocked ? "Blocked" : "Human hold";

  return (
    <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">Resolve blocker</h3>
        <p className="text-xs leading-5 text-muted-foreground">
          {holdLabel}: add the answer the agent needs, then resume queue pickup.
        </p>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Answer for the agent..."
        className="min-h-20 w-full resize-y rounded-md border bg-background/70 px-2.5 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-background/70"
      />
      <div className="flex flex-col gap-1.5">
        <OpenEngineActionButton
          disabled={saving || !message.trim()}
          onClick={() => submit("ANSWER_BLOCKER")}
        >
          Save answer and resume
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving}
          onClick={() => submit("RELEASE_HOLD", "Released by human operator.")}
        >
          Resume without answer
        </OpenEngineActionButton>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function OpenEngineActionButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-8 justify-center bg-background/60 px-2 text-xs dark:bg-background/60"
    >
      {children}
    </Button>
  );
}

function formatOpenEngineActionError(message: string) {
  if (
    message.includes("RecordOpenEngineHumanActionInput") ||
    message.includes("recordOpenEngineHumanAction")
  ) {
    return "OpenEngine actions are not available from the connected API yet. Try again after the API deploy finishes.";
  }
  return message;
}

function openEngineState(item: WorkItemSummary) {
  if (!item.openEngineEnabled) {
    return {
      label: "Not enabled",
      detail: "Not in the OpenEngine queue",
      icon: <CircleDot className="size-4" />,
      tone: "text-muted-foreground",
    };
  }
  if (item.completedAt) {
    return {
      label: "Done",
      detail: "Completed",
      icon: <CheckCircle2 className="size-4" />,
      tone: "text-emerald-500",
    };
  }
  if (item.blocked || item.openEngineHumanHold) {
    return {
      label: item.blocked ? "Blocked" : "Human hold",
      detail: item.openEngineHumanHoldReason || "Waiting on a human",
      icon: <PauseCircle className="size-4" />,
      tone: item.blocked ? "text-red-500" : "text-amber-500",
    };
  }
  if (item.openEngineClaimedByAgentId) {
    return {
      label: "Claimed",
      detail: truncateMiddle(item.openEngineClaimedByAgentId) || "Agent active",
      icon: <Bot className="size-4" />,
      tone: "text-blue-500",
    };
  }
  if (isFutureDate(item.openEngineScheduledAt)) {
    return {
      label: "Scheduled",
      detail: formatDate(item.openEngineScheduledAt),
      icon: <Clock className="size-4" />,
      tone: "text-muted-foreground",
    };
  }
  if (item.openEngineDependencyState === "WAITING") {
    return {
      label: "Waiting",
      detail: "Dependency not ready",
      icon: <AlertTriangle className="size-4" />,
      tone: "text-amber-500",
    };
  }
  return {
    label: "Ready",
    detail: "Eligible for pickup",
    icon: <LockOpen className="size-4" />,
    tone: "text-emerald-500",
  };
}

function latestOpenEngineEvent(events: WorkItemEventSummary[]) {
  return events.find((event) => {
    const metadata = objectRecord(event.metadata);
    return (
      event.actorAgentId ||
      metadata.source === "open_engine" ||
      metadata.source === "open_engine_human_action"
    );
  });
}

function latestOpenEngineStatusLedger(documents: WorkItemDocumentSummary[]) {
  return documents.find((document) => {
    const metadata = objectRecord(document.metadata);
    return metadata.openEngineStatusLedger === true;
  });
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

function workItemKey(item: WorkItemSummary) {
  const metadata = objectRecord(item.metadata);
  const key =
    stringValue(metadata.key) ||
    stringValue(metadata.number) ||
    stringValue(metadata.externalKey) ||
    item.externalRefs?.[0]?.externalId;
  if (key) return key;
  return `WI-${item.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 5)
    .toUpperCase()}`;
}

function formatBytes(value?: number | null) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "None";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.round(diffMs / day)}d ago`;
  return formatDate(value);
}

function activityTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (isSameLocalDay(date, new Date())) return relativeDate(value);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }
  return date.toLocaleDateString(undefined, options);
}

function absoluteDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isFutureDate(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function truncateMiddle(value?: string | null) {
  if (!value) return "";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function dateTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeEventType(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isMirroredOpenEngineReceiptEvent(event: WorkItemEventSummary) {
  if (normalizeEventType(event.eventType) !== "agent_action") return false;
  const metadata = objectRecord(event.metadata);
  if (metadata.source !== "open_engine") return false;
  const receiptType = stringValue(metadata.receiptType);
  return Boolean(receiptType && shouldMirrorReceiptAsComment(receiptType));
}

function shouldMirrorReceiptAsComment(receiptType: string) {
  return ![
    "skill_subscribed",
    "skill_installed",
    "skill_updated",
    "skill_declined",
  ].includes(receiptType);
}

function buildActivityItems(
  comments: WorkItemCommentSummary[],
  events: WorkItemEventSummary[],
): WorkItemActivityItem[] {
  return [
    ...comments.map((comment) => ({
      kind: "comment" as const,
      id: comment.id,
      createdAt: comment.createdAt,
      comment,
    })),
    ...events.map((event) => ({
      kind: "event" as const,
      id: event.id,
      createdAt: event.createdAt,
      event,
    })),
  ].sort((left, right) => dateTime(right.createdAt) - dateTime(left.createdAt));
}

function hasFollowingTimelineEvent(
  activityItems: WorkItemActivityItem[],
  currentIndex: number,
) {
  const nextItem = activityItems[currentIndex + 1];
  return (
    nextItem?.kind === "event" &&
    isWorkItemActivityTimelineEvent(nextItem.event)
  );
}

function commentAuthor(
  comment: WorkItemCommentSummary,
  assignees: WorkItemAssigneeSummary[],
) {
  if (comment.authorUserId) {
    const assignee = assignees.find(
      (entry) => entry.id === comment.authorUserId,
    );
    return assignee?.name ?? "User";
  }
  if (comment.authorAgentId) return comment.authorAgentId;
  return "System";
}

function eventLabel(value?: string | null) {
  return String(value ?? "activity")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function externalRefTitle(
  ref: NonNullable<WorkItemSummary["externalRefs"]>[0],
) {
  return [ref.provider ?? "External", ref.externalId].filter(Boolean).join(" ");
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
