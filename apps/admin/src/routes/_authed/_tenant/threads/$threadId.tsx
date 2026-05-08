import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useSubscription } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialog } from "@/context/DialogContext";
import { usePanel } from "@/context/PanelContext";
import { InlineEditor } from "@/components/threads/InlineEditor";
import { LiveRunWidget } from "@/components/threads/LiveRunWidget";
import { ThreadLifecycleBadge } from "@/components/threads/ThreadLifecycleBadge";
import { Identity } from "@/components/Identity";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { graphql } from "@/gql";
import { ThreadLifecycleStatus } from "@/gql/graphql";
import {
  ThreadDetailQuery,
  UpdateThreadMutation,
  DeleteThreadMutation,
  AgentsListQuery,
  OnThreadUpdatedSubscription,
  OnThreadTurnUpdatedSubscription,
  ThreadTracesQuery,
} from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Lock,
  MoreHorizontal,
  Paperclip,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { ThreadFormDialog } from "@/components/threads/CreateThreadDialog";
import { ArtifactViewDialog } from "@/components/threads/ArtifactViewDialog";
import { ExecutionTrace } from "@/components/threads/ExecutionTrace";
import { ThreadTraces, xrayTraceUrl } from "@/components/threads/ThreadTraces";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArtifactsListQuery, ArtifactDetailQuery } from "@/lib/graphql-queries";
import { useClient } from "urql";
import { buildThreadBreadcrumbs } from "./-thread-breadcrumbs";

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authed/_tenant/threads/$threadId")({
  component: ThreadDetailPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { fromAgentId?: string; fromAgentName?: string } => ({
    fromAgentId: (search.fromAgentId as string) || undefined,
    fromAgentName: (search.fromAgentName as string) || undefined,
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_LABELS: Record<string, string> = {
  chat: "Manual chat",
  manual: "Manual chat",
  schedule: "Schedule",
  webhook: "Webhook",
  api: "Automation",
  email: "Email",
};

function triggerLabel(channel: string | null | undefined): string {
  if (channel === null || channel === undefined || channel === "") return "—";
  const lower = channel.toLowerCase();
  // Unrecognized values render the raw string (not "Unknown") so unexpected
  // channels surface during review instead of hiding silently.
  return TRIGGER_LABELS[lower] ?? channel;
}

function formatTurnCostSummary(
  turnCount: number,
  tokenCount: number,
  costSummary: number | null | undefined,
): string {
  const parts: string[] = [];
  parts.push(`${turnCount} turn${turnCount === 1 ? "" : "s"}`);
  if (tokenCount > 0) {
    parts.push(
      `${tokenCount.toLocaleString()} token${tokenCount === 1 ? "" : "s"}`,
    );
  }
  if (costSummary !== null && costSummary !== undefined && costSummary > 0) {
    parts.push(`$${costSummary.toFixed(4)}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Activity types & helpers
// ---------------------------------------------------------------------------

interface ActivityEvent {
  id: string;
  action: string;
  actorType: string;
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  "ticket.created": "created the thread",
  "ticket.updated": "updated the thread",
  "ticket.checked_out": "checked out the thread",
  "ticket.released": "released the thread",
  "ticket.comment_added": "added a comment",
  "ticket.attachment_added": "added an attachment",
  "ticket.attachment_removed": "removed an attachment",
  "ticket.deleted": "deleted the thread",
  "agent.created": "created an agent",
  "agent.updated": "updated the agent",
  "agent.paused": "paused the agent",
  "agent.resumed": "resumed the agent",
  "agent.terminated": "terminated the agent",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "inbox_item.created": "requested approval",
  "inbox_item.approved": "approved",
  "inbox_item.rejected": "rejected",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function formatAction(
  action: string,
  details?: Record<string, unknown> | null,
): string {
  if (action === "ticket.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    if (details.status !== undefined) {
      const from = previous.status;
      parts.push(
        from
          ? `changed the status from ${humanizeValue(from)} to ${humanizeValue(details.status)}`
          : `changed the status to ${humanizeValue(details.status)}`,
      );
    }
    if (details.assigneeId !== undefined) {
      parts.push(
        details.assigneeId ? "assigned the thread" : "unassigned the thread",
      );
    }
    if (details.title !== undefined) parts.push("updated the title");

    if (parts.length > 0) return parts.join(", ");
  }
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function ActorIdentity({
  evt,
  agentMap,
}: {
  evt: ActivityEvent;
  agentMap: Map<string, AgentRef>;
}) {
  const id = evt.actorId;
  if (evt.actorType === "agent") {
    const agent = agentMap.get(id);
    return (
      <Identity
        name={agent?.name ?? id.slice(0, 8)}
        avatarUrl={agent?.avatarUrl}
        size="sm"
      />
    );
  }
  if (evt.actorType === "system") return <Identity name="System" size="sm" />;
  if (evt.actorType === "user") return <Identity name="You" size="sm" />;
  return <Identity name={id || "Unknown"} size="sm" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ThreadDetailPage() {
  const { threadId } = Route.useParams();
  const { fromAgentId, fromAgentName } = Route.useSearch();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { openNewThread } = useDialog();
  const {
    open: openPanel,
    close: closePanel,
    isOpen: panelVisible,
    toggle: togglePanel,
  } = usePanel();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  // detailTab removed — sections are now inline (Linear-style)
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [viewingArtifact, setViewingArtifact] = useState<any>(null);
  const urqlClient = useClient();

  const openArtifact = useCallback(
    async (a: any) => {
      // Fetch full content if not already loaded
      if (a.content) {
        setViewingArtifact(a);
        return;
      }
      try {
        const result = await urqlClient
          .query(ArtifactDetailQuery, { id: a.id })
          .toPromise();
        const full = (result.data as any)?.artifact;
        setViewingArtifact(full ?? a);
      } catch {
        setViewingArtifact(a);
      }
    },
    [urqlClient],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Queries ----
  const [threadResult, reexecuteThread] = useQuery({
    query: ThreadDetailQuery,
    variables: { id: threadId },
  });

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [artifactsResult] = useQuery({
    query: ArtifactsListQuery,
    variables: { tenantId: tenantId!, threadId: threadId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [, updateThread] = useMutation(UpdateThreadMutation);
  const [, deleteThread] = useMutation(DeleteThreadMutation);

  // Live subscriptions — refetch when this thread updates
  const [threadSub] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (threadSub.data?.onThreadUpdated?.threadId === threadId) {
      reexecuteThread({ requestPolicy: "network-only" });
    }
  }, [threadSub.data, threadId, reexecuteThread]);

  const [turnSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  useEffect(() => {
    if (turnSub.data?.onThreadTurnUpdated) {
      reexecuteThread({ requestPolicy: "network-only" });
    }
  }, [turnSub.data, reexecuteThread]);

  const thread = threadResult.data?.thread;
  const isComputerOwnedThread = Boolean((thread as any)?.computerId);
  const agents = agentsResult.data?.agents ?? [];

  // ---- Derived data ----
  const agentMap = useMemo(() => {
    const map = new Map<string, AgentRef>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  // TODO: Wire to a real activity feed query when available
  const activity: ActivityEvent[] = [];

  const threadMessages = useMemo(
    () =>
      (thread?.messages?.edges ?? []).map((e: any) => ({
        id: e.node.id,
        role: e.node.role,
        content: e.node.content,
        senderType: e.node.senderType ?? null,
        senderId: e.node.senderId ?? null,
        createdAt: e.node.createdAt,
        durableArtifact: e.node.durableArtifact ?? null,
      })),
    [thread?.messages],
  );

  const attachmentList = thread?.attachments ?? [];
  const hasAttachments = attachmentList.length > 0;

  // ---- Handlers (must be before useEffect that references them) ----
  const refetch = useCallback(
    () => reexecuteThread({ requestPolicy: "network-only" }),
    [reexecuteThread],
  );

  const handleFieldUpdate = useCallback(
    async (data: Record<string, unknown>) => {
      await updateThread({ id: threadId, input: data as any });
      reexecuteThread({ requestPolicy: "network-only" });
    },
    [threadId, updateThread, reexecuteThread],
  );

  // ---- Breadcrumbs ----
  // Computer-owned threads route through /computers/$computerId; Agent-owned
  // threads with a `?fromAgent=...` query param keep the existing Agent
  // breadcrumb; everything else falls back to the Threads root. Decision logic
  // lives in `-thread-breadcrumbs.ts` so it can be unit-tested.
  useBreadcrumbs(
    buildThreadBreadcrumbs({
      thread,
      fromAgentId,
      fromAgentName,
    }),
  );

  // ---- Side panel for properties ----
  useEffect(() => {
    if (thread) {
      openPanel(
        <ThreadProperties
          thread={thread}
          loading={threadResult.fetching && !thread.lifecycleStatus}
        />,
      );
    }
    return () => closePanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  // ---- Loading & Error states ----
  if (threadResult.fetching && !thread) return <PageSkeleton />;
  if (threadResult.error)
    return (
      <p className="text-sm text-destructive">{threadResult.error.message}</p>
    );
  if (!thread) return null;

  const handleDelete = async () => {
    await deleteThread({ id: threadId });
    navigate({ to: "/threads" });
  };

  const handleFilePicked = async (evt: ChangeEvent<HTMLInputElement>) => {
    // TODO: Wire to attachment upload mutation when available
    const files = evt.target.files;
    if (!files || files.length === 0) return;
    setAttachmentError("Attachment upload is not yet implemented.");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAttachmentDrop = async (evt: DragEvent<HTMLDivElement>) => {
    evt.preventDefault();
    setAttachmentDragActive(false);
    // TODO: Wire to attachment upload mutation when available
    setAttachmentError("Attachment upload is not yet implemented.");
  };

  const attachmentUploadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,text/plain,text/markdown,application/json,text/csv,text/html,.md,.markdown"
        className="hidden"
        onChange={handleFilePicked}
        multiple
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1",
          attachmentDragActive && "text-primary",
        )}
      >
        <Paperclip className="h-3 w-3" />
        Upload attachment
      </button>
    </>
  );

  const artifacts = (artifactsResult.data as any)?.artifacts ?? [];

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex gap-8 min-w-0">
        {/* ── Main content (left) ───────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Header: identifier / title / description */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-muted-foreground">
                {thread.identifier ?? `#${thread.number}`}
              </span>
              {thread.checkoutRunId && (
                <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                  <Lock className="h-3 w-3" />
                  {thread.checkoutRunId.slice(0, 8)}
                </span>
              )}

              {/* Mobile properties toggle */}
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto md:hidden shrink-0"
                onClick={() => setMobilePropsOpen(true)}
                title="Properties"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>

              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 ml-auto hidden md:flex"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <Popover
                    open={deleteConfirmOpen}
                    onOpenChange={setDeleteConfirmOpen}
                  >
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-destructive">
                        <Trash2 className="h-3 w-3" />
                        Delete thread
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3" align="end">
                      <p className="text-sm mb-3">
                        Are you sure? This action cannot be undone.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setDeleteConfirmOpen(false);
                            setMoreOpen(false);
                            void handleDelete();
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </PopoverContent>
              </Popover>
            </div>

            {/* Title */}
            <InlineEditor
              value={thread.title}
              onSave={(title) => handleFieldUpdate({ title })}
              as="h2"
              className="text-xl font-bold"
            />
          </div>

          {/* ── Activity (turns + messages merged timeline) ─────────── */}
          <Separator />
          <div className="space-y-2">
            <LiveRunWidget threadId={threadId} tenantId={tenantId} />
            <ExecutionTrace
              threadId={threadId}
              tenantId={tenantId || ""}
              messages={threadMessages}
              agentMap={agentMap}
              defaultAgentName={thread.agent?.name}
              assistantLabel={isComputerOwnedThread ? "Computer" : undefined}
              onOpenArtifact={openArtifact}
            />
          </div>

          {/* ── Traces ───────────────────────────────────────────────── */}
          {tenantId && (
            <>
              <Separator />
              <TracesSection threadId={threadId} tenantId={tenantId} />
            </>
          )}
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────── */}
        <aside className="hidden md:block w-64 shrink-0 space-y-3">
          {/* Properties */}
          <div className="rounded-lg border border-border bg-accent/30 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Properties
            </h3>
            <ThreadProperties
              thread={thread}
              inline
              loading={threadResult.fetching && !thread.lifecycleStatus}
            />
          </div>

          {/* Attachments */}
          <div className="rounded-lg border border-border bg-accent/30 p-3.5 space-y-2.5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Attachments
            </h3>
            {attachmentList.map((attachment) => (
              <div
                key={attachment.id}
                className="rounded-md border border-border bg-background p-2"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="text-xs truncate"
                    title={attachment.name ?? attachment.id}
                  >
                    {attachment.name ?? attachment.id}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {attachment.mimeType ?? "unknown"}
                  {attachment.sizeBytes
                    ? ` · ${(attachment.sizeBytes / 1024).toFixed(1)} KB`
                    : ""}
                </p>
              </div>
            ))}
            {attachmentUploadButton}
            {attachmentError && (
              <p className="text-xs text-destructive">{attachmentError}</p>
            )}
          </div>

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <div className="rounded-lg border border-border bg-accent/30 p-3.5 space-y-2.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Artifacts
              </h3>
              <div className="rounded-md border border-border divide-y divide-border bg-background">
                {artifacts.map((a: any) => (
                  <button
                    key={a.id}
                    onClick={() => openArtifact(a)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-xs hover:bg-accent/40 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{a.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <ArtifactViewDialog
        open={viewingArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setViewingArtifact(null);
        }}
        artifact={viewingArtifact}
      />

      <ThreadFormDialog
        mode="edit"
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        initial={{
          id: threadId,
          title: thread.title,
          status: thread.status.toLowerCase().replace(/ /g, "_"),
          agentId: thread.agent?.id ?? "",
          dueAt: thread.dueAt ?? "",
        }}
        onSaved={refetch}
      />

      {/* Mobile properties drawer */}
      <Sheet open={mobilePropsOpen} onOpenChange={setMobilePropsOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader>
            <SheetTitle className="text-sm">Properties</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <ThreadProperties
                thread={thread}
                inline
                loading={threadResult.fetching && !thread.lifecycleStatus}
              />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties sidebar / inline panel
// ---------------------------------------------------------------------------

interface ThreadPropertiesProps {
  thread: {
    readonly id: string;
    readonly lifecycleStatus?: ThreadLifecycleStatus | null;
    readonly channel?: string | null;
    readonly assigneeType?: string | null;
    readonly assigneeId?: string | null;
    readonly computerId?: string | null;
    readonly agent?: {
      readonly id: string;
      readonly name: string;
      readonly avatarUrl?: string | null;
    } | null;
    readonly billingCode?: string | null;
    readonly dueAt?: string | null;
    readonly startedAt?: string | null;
    readonly completedAt?: string | null;
    readonly cancelledAt?: string | null;
    readonly checkoutRunId?: string | null;
    readonly costSummary?: number | null;
    readonly messages?: {
      readonly edges?: ReadonlyArray<{
        readonly node?: {
          readonly role?: string | null;
          readonly tokenCount?: number | null;
        } | null;
      }> | null;
    } | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  inline?: boolean;
  loading?: boolean;
}

function ThreadProperties({ thread, inline, loading }: ThreadPropertiesProps) {
  // Turn + token + cost summary computed from the existing messages edges.
  // Turn count = assistant message count (a proxy for agent-turn count that
  // avoids an extra query; mirrors the Activity header's existing shape).
  // Tokens = sum of tokenCount across all messages.
  const edges = thread.messages?.edges ?? [];
  let turnCount = 0;
  let tokenCount = 0;
  for (const edge of edges) {
    const node = edge?.node;
    if (!node) continue;
    if (node.role === "assistant") turnCount++;
    if (typeof node.tokenCount === "number") tokenCount += node.tokenCount;
  }
  const turnCostSummary = formatTurnCostSummary(
    turnCount,
    tokenCount,
    thread.costSummary ?? null,
  );

  return (
    <div className={cn("space-y-3", !inline && "p-4")}>
      {!inline && (
        <h3 className="text-sm font-semibold text-muted-foreground">
          Properties
        </h3>
      )}

      <PropRow label="Status">
        <ThreadLifecycleBadge
          lifecycleStatus={thread.lifecycleStatus ?? null}
          threadId={thread.id}
          loading={loading ?? false}
        />
      </PropRow>

      <PropRow label="Trigger">
        <span className="text-xs">{triggerLabel(thread.channel)}</span>
      </PropRow>

      {turnCount > 0 && (
        <PropRow label="Turns">
          <span className="text-xs text-muted-foreground">
            {turnCostSummary}
          </span>
        </PropRow>
      )}

      {thread.computerId ? (
        <PropRow label="Computer">
          <Badge variant="outline" className="text-xs">
            Computer-owned
          </Badge>
        </PropRow>
      ) : thread.agent ? (
        <PropRow label="Agent">
          <Link
            to="/agents/$agentId"
            params={{ agentId: thread.agent.id }}
            className="flex items-center gap-1 hover:bg-accent rounded-md px-1 -mx-1 transition-colors"
          >
            <Identity
              name={thread.agent.name}
              avatarUrl={thread.agent.avatarUrl}
              size="sm"
            />
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </Link>
        </PropRow>
      ) : null}

      {thread.checkoutRunId && (
        <PropRow label="Checkout">
          <Badge
            variant="outline"
            className="text-yellow-600 border-yellow-600"
          >
            <Lock className="h-3 w-3 mr-1" />
            {thread.checkoutRunId.slice(0, 8)}
          </Badge>
        </PropRow>
      )}

      {thread.billingCode && (
        <PropRow label="Billing Code">
          <Badge variant="outline">{thread.billingCode}</Badge>
        </PropRow>
      )}

      {thread.dueAt && (
        <PropRow label="Due">{formatDateTime(thread.dueAt)}</PropRow>
      )}
      <PropRow label="Created">{formatDateTime(thread.createdAt)}</PropRow>
      <PropRow label="Updated">{relativeTime(thread.updatedAt)}</PropRow>
      {thread.startedAt && (
        <PropRow label="Started">{formatDateTime(thread.startedAt)}</PropRow>
      )}
      {thread.completedAt && (
        <PropRow label="Completed">
          {formatDateTime(thread.completedAt)}
        </PropRow>
      )}
      {thread.cancelledAt && (
        <PropRow label="Cancelled">
          {formatDateTime(thread.cancelledAt)}
        </PropRow>
      )}
    </div>
  );
}

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Traces section
// ---------------------------------------------------------------------------

function TracesSection({
  threadId,
  tenantId,
}: {
  threadId: string;
  tenantId: string;
}) {
  const [open, setOpen] = useState(false);

  // Fetch traces at the section level so the header can deeplink to the
  // most-recent trace. The child ThreadTraces component runs the same
  // ThreadTracesQuery; urql dedupes by (document, variables) so this is a
  // single network call.
  const [tracesResult] = useQuery({
    query: ThreadTracesQuery,
    variables: { threadId, tenantId },
    pause: !threadId || !tenantId,
  });
  const firstTraceId = tracesResult.data?.threadTraces?.[0]?.traceId ?? null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center py-1">
        <CollapsibleTrigger className="flex-1 text-left">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Traces
          </div>
        </CollapsibleTrigger>
        {firstTraceId && (
          <a
            href={xrayTraceUrl(firstTraceId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Open latest trace in X-Ray"
          >
            Open in X-Ray
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <CollapsibleContent>
        <ThreadTraces threadId={threadId} tenantId={tenantId} />
      </CollapsibleContent>
    </Collapsible>
  );
}
