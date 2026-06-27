import type React from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  CircleDot,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Link2,
  LockOpen,
  MessageSquareText,
  MoreHorizontal,
  PauseCircle,
  UserRound,
} from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Response } from "@/components/ai-elements/response";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  RecordOpenEngineHumanActionMutation,
  SpacesQuery,
  WorkItemDocumentQuery,
  WorkItemDocumentsQuery,
  WorkItemQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "urql";
import type {
  WorkItemAssigneeSummary,
  WorkItemDocumentSummary,
  WorkItemEventSummary,
  WorkItemSpaceSummary,
  WorkItemSummary,
} from "./work-item-display";
import {
  workItemAssigneeLabel,
  workItemPriorityLabel,
  workItemSpaceLabel,
  workItemStatusCategoryLabel,
} from "./work-item-display";
import {
  DEFAULT_WORK_ITEM_SEARCH,
  workItemRouteSearchToParams,
} from "./work-item-filters";

interface WorkItemResult {
  workItem?: WorkItemSummary | null;
}

interface WorkItemDocumentsResult {
  workItemDocuments?: WorkItemDocumentSummary[] | null;
}

interface WorkItemDocumentResult {
  workItemDocument?: WorkItemDocumentSummary | null;
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

type OpenEngineHumanActionType =
  | "ANSWER_BLOCKER"
  | "RELEASE_HOLD"
  | "REQUEST_REVIEW"
  | "MARK_REVIEWED"
  | "MARK_BLOCKED"
  | "MARK_FAILED";

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
  const [{ fetching: humanActionSaving }, executeHumanAction] = useMutation(
    RecordOpenEngineHumanActionMutation,
  );
  const [humanActionError, setHumanActionError] = useState<string | null>(null);

  const item = data?.workItem ?? null;
  const itemKey = item ? workItemKey(item) : "Work Item";
  usePageHeaderActions({
    title: item?.title ?? "Work Item",
    documentTitle: item ? `${itemKey} ${item.title}` : "Work Item",
    breadcrumbs: [
      {
        label: "Work Items",
        href: "/work-items",
        search: workItemRouteSearchToParams(
          DEFAULT_WORK_ITEM_SEARCH,
        ) as Record<string, unknown>,
      },
      { label: item ? `${itemKey} ${item.title}` : "Work Item" },
    ],
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
  const documents = documentsData?.workItemDocuments ?? [];
  const events = [...(item.events ?? [])].sort(
    (left, right) => dateTime(right.createdAt) - dateTime(left.createdAt),
  );
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
      setHumanActionError(result.error.message);
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
              events={events}
              assignees={assignees}
              onRefresh={reexecuteWorkItem}
            />
          </div>

          <aside className="space-y-3 lg:sticky lg:top-5 lg:self-start">
            <RailSection title="Properties">
              <PropertyRow
                icon={<CircleDot className="size-4" />}
                label="Status"
                value={
                  item.status?.name ??
                  workItemStatusCategoryLabel(item.status?.category)
                }
              />
              <PropertyRow
                icon={<GitBranch className="size-4" />}
                label="Priority"
                value={workItemPriorityLabel(item.priority)}
              />
              <PropertyRow
                icon={<UserRound className="size-4" />}
                label="Assignee"
                value={workItemAssigneeLabel(item, assignees)}
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
              <PropertyRow
                icon={<Link2 className="size-4" />}
                label="Space"
                value={workItemSpaceLabel(item.spaceId, spaces)}
              />
            </RailSection>

            <OpenEngineRailSection
              item={item}
              events={events}
              documents={documents}
              saving={humanActionSaving}
              error={humanActionError}
              onAction={handleOpenEngineHumanAction}
            />

            <RailSection title="Labels">
              {item.labels?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.labels.map((label) => (
                    <Badge
                      key={label.id}
                      variant="outline"
                      className="h-6 gap-1.5 rounded-full bg-muted/10 px-2 text-xs"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: label.color ?? "#64748b" }}
                      />
                      {label.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No labels</p>
              )}
            </RailSection>
          </aside>
        </div>
      </div>
    </main>
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
  const [{ data: documentData, fetching: documentFetching, error: documentError }] =
    useQuery<WorkItemDocumentResult>({
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
        search: workItemRouteSearchToParams(
          DEFAULT_WORK_ITEM_SEARCH,
        ) as Record<string, unknown>,
      },
      {
        label: itemKey,
        href: `/work-items/${workItemId}`,
      },
      { label: document?.title ?? "Document" },
    ],
  });

  if (!tenantId || ((itemFetching || documentFetching) && (!item || !document))) {
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
  events,
  assignees,
  onRefresh,
}: {
  events: WorkItemEventSummary[];
  assignees: WorkItemAssigneeSummary[];
  onRefresh: (opts?: { requestPolicy?: "network-only" }) => void;
}) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Activity" detail={`${events.length}`} />
      {events.length === 0 ? (
        <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
          No activity recorded yet.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <article
              key={event.id}
              className="rounded-md border bg-muted/40 p-4 dark:bg-muted/40"
            >
              <header className="flex min-w-0 items-center gap-1.5">
                <ActivityAvatar event={event} assignees={assignees} />
                <span className="truncate text-xs font-semibold text-foreground">
                  {eventActor(event, assignees)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {eventLabel(event.eventType).toLowerCase()}
                </span>
                <span className="text-xs text-muted-foreground">
                  {relativeDate(event.createdAt)}
                </span>
              </header>
              <ActivityMarkdown
                content={event.message}
                empty="No message recorded."
              />
            </article>
          ))}
        </div>
      )}
      <button
        type="button"
        className="text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onRefresh({ requestPolicy: "network-only" })}
      >
        Refresh activity
      </button>
    </section>
  );
}

function ActivityAvatar({
  event,
  assignees,
}: {
  event: WorkItemEventSummary;
  assignees: WorkItemAssigneeSummary[];
}) {
  const actor = eventActor(event, assignees);
  const initials = actorInitials(actor);
  const agent = Boolean(event.actorAgentId);

  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
        agent ? "bg-blue-500" : "bg-pink-500",
      )}
      aria-hidden="true"
    >
      {initials || <MessageSquareText className="size-3" />}
    </span>
  );
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-muted/35 p-3 dark:bg-muted/35">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
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

function OpenEngineRailSection({
  item,
  events,
  documents,
  saving,
  error,
  onAction,
}: {
  item: WorkItemSummary;
  events: WorkItemEventSummary[];
  documents: WorkItemDocumentSummary[];
  saving: boolean;
  error: string | null;
  onAction: (
    actionType: OpenEngineHumanActionType,
    message: string,
  ) => Promise<boolean>;
}) {
  const state = openEngineState(item);
  const latestReceipt = latestOpenEngineEvent(events);
  const latestLedger = latestOpenEngineStatusLedger(documents);

  return (
    <RailSection title="OpenEngine">
      <div className="flex items-center gap-2 rounded-md border bg-background/50 px-2.5 py-2 dark:bg-background/50">
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

      <PropertyRow
        icon={<Bot className="size-4" />}
        label="Queue"
        value={item.openEngineQueueKey || "Default"}
      />
      <PropertyRow
        icon={<Bot className="size-4" />}
        label="Agent"
        value={truncateMiddle(item.openEngineClaimedByAgentId) || "None"}
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

      {item.openEngineHumanHoldReason ? (
        <div className="rounded-md border bg-background/50 px-2.5 py-2 text-xs leading-5 text-muted-foreground dark:bg-background/50">
          <span className="font-medium text-foreground">Hold reason: </span>
          {item.openEngineHumanHoldReason}
        </div>
      ) : null}

      {latestReceipt ? (
        <div className="rounded-md border bg-background/50 px-2.5 py-2 dark:bg-background/50">
          <p className="text-xs font-medium text-muted-foreground">
            Latest receipt
          </p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-foreground">
            {latestReceipt.message || eventLabel(latestReceipt.eventType)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {relativeDate(latestReceipt.createdAt)}
          </p>
        </div>
      ) : null}

      {latestLedger ? (
        <Link
          to="/work-items/$workItemId/documents/$documentId"
          params={{ workItemId: item.id, documentId: latestLedger.id }}
          className="flex items-center gap-2 rounded-md border bg-background/50 px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-background/50"
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{latestLedger.title}</span>
          <span className="shrink-0 text-muted-foreground">
            {relativeDate(latestLedger.updatedAt ?? latestLedger.createdAt)}
          </span>
        </Link>
      ) : null}

      <OpenEngineHumanActionControls
        item={item}
        saving={saving}
        error={error}
        onAction={onAction}
      />
    </RailSection>
  );
}

function OpenEngineHumanActionControls({
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
  const submit = async (actionType: OpenEngineHumanActionType) => {
    const didSave = await onAction(actionType, message);
    if (didSave) {
      setMessage("");
    }
  };
  const isHeld = Boolean(item.blocked || item.openEngineHumanHold);

  return (
    <div className="space-y-2 pt-1">
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Human response or reason..."
        className="min-h-20 w-full resize-y rounded-md border bg-background/60 px-2.5 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-background/60"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <OpenEngineActionButton
          disabled={saving || !isHeld}
          onClick={() => submit("ANSWER_BLOCKER")}
        >
          Answer
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving || !isHeld}
          onClick={() => submit("RELEASE_HOLD")}
        >
          Resume
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving}
          onClick={() => submit("REQUEST_REVIEW")}
        >
          Review
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving}
          onClick={() => submit("MARK_REVIEWED")}
        >
          Reviewed
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving}
          onClick={() => submit("MARK_BLOCKED")}
        >
          Block
        </OpenEngineActionButton>
        <OpenEngineActionButton
          disabled={saving}
          onClick={() => submit("MARK_FAILED")}
        >
          Fail
        </OpenEngineActionButton>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-md border bg-background/60 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background/60"
    >
      {children}
    </button>
  );
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
  return `WI-${item.id.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase()}`;
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

function eventActor(
  event: WorkItemEventSummary,
  assignees: WorkItemAssigneeSummary[],
) {
  if (event.actorUserId) {
    const assignee = assignees.find((entry) => entry.id === event.actorUserId);
    return assignee?.name ?? "User";
  }
  if (event.actorAgentId) return event.actorAgentId;
  return "System";
}

function actorInitials(actor: string) {
  return actor
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function eventLabel(value?: string | null) {
  return String(value ?? "activity")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function externalRefTitle(ref: NonNullable<WorkItemSummary["externalRefs"]>[0]) {
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
