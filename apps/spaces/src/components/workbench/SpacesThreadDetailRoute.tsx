import { useEffect, useMemo, useRef, useState } from "react";
import { useClient, useMutation, useQuery, useSubscription } from "urql";
import { Info, Maximize2, Minimize2, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import {
  parseSpaceRecord,
  type LinkedTaskSummary,
} from "@/components/spaces/space-types";
import {
  TaskThreadView,
  normalizePersistedParts,
  type ComposerMention,
  type TaskThread,
  type TaskThreadInfoPanelState,
} from "@/components/workbench/TaskThreadView";
import type { GeneratedArtifact } from "@/components/workbench/GeneratedArtifactCard";
import { ThreadDetailActions } from "@/components/workbench/ThreadDetailActions";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerEventsQuery,
  ComputerThreadQuery,
  ComputerThreadTasksQuery,
  NewMessageSubscription,
  RunbookRunsQuery,
  SendMessageMutation,
  ThreadArtifactsQuery,
  ThreadLinkedTasksQuery,
  ThreadMentionTargetsQuery,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import { createAppSyncChatTransport } from "@/lib/use-chat-appsync-transport";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { notifyAgentCompletion } from "@/lib/desktop-notifications";

interface SpacesThreadDetailRouteProps {
  threadId: string;
  backHref?: string;
  documentTitlePrefix?: string;
}

interface ThreadResult {
  thread: {
    id: string;
    userId?: string | null;
    computerId?: string | null;
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
    } | null;
    computer?: {
      id: string;
      name?: string | null;
      slug?: string | null;
    } | null;
    title?: string | null;
    status?: string | null;
    spaceId?: string | null;
    lifecycleStatus?: string | null;
    metadata?: unknown;
    costSummary?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    messages?: {
      edges?: Array<{
        node: {
          id: string;
          role: string;
          content?: string | null;
          parts?: unknown;
          createdAt?: string | null;
          metadata?: unknown;
          toolCalls?: unknown;
          toolResults?: unknown;
          sender?: {
            type?: string | null;
            id?: string | null;
            displayName?: string | null;
            avatarUrl?: string | null;
          } | null;
          mentions?: Array<{
            id: string;
            targetType?: string | null;
            targetId?: string | null;
            displayName?: string | null;
          }> | null;
          durableArtifact?: {
            id: string;
            title: string;
            type?: string | null;
            summary?: string | null;
            metadata?: unknown;
          } | null;
        };
      }>;
    } | null;
    attachments?: Array<{
      id: string;
      name?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      uploadedBy?: string | null;
      createdAt?: string | null;
    }> | null;
  } | null;
}

interface ThreadTasksResult {
  computerTasks?: Array<{
    id: string;
    taskType?: string | null;
    status?: string | null;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    claimedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }> | null;
}

interface ThreadEventsResult {
  computerEvents?: Array<{
    id: string;
    taskId?: string | null;
    eventType?: string | null;
    level?: string | null;
    payload?: unknown;
    createdAt?: string | null;
  }> | null;
}

interface RunbookRunsResult {
  runbookRuns?: Array<{
    id: string;
    runbookSlug?: string | null;
    runbookVersion?: string | null;
    status?: string | null;
    tasks?: Array<{
      id: string;
      phaseId?: string | null;
      phaseTitle?: string | null;
      taskKey?: string | null;
      title?: string | null;
      summary?: string | null;
      status?: string | null;
      dependsOn?: unknown;
      capabilityRoles?: unknown;
      sortOrder?: number | null;
    }> | null;
    definitionSnapshot?: unknown;
    updatedAt?: string | null;
  }> | null;
}

interface MentionTargetsResult {
  threadMentionTargets?: MentionTarget[] | null;
}

interface ThreadLinkedTasksResult {
  threadLinkedTasks?: LinkedTaskSummary[] | null;
}

export function SpacesThreadDetailRoute({
  threadId,
  backHref,
  documentTitlePrefix = "Thread",
}: SpacesThreadDetailRouteProps) {
  const { tenantId } = useTenant();
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [threadInfoOpen, setThreadInfoOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id: threadId, messageLimit: 100 },
  });
  const routeThread = data?.thread?.id === threadId ? data.thread : null;
  const hasMismatchedThreadData = Boolean(data?.thread && !routeThread);
  const threadTitle = routeThread?.title?.trim() || "Thread";

  // Attached artifacts feed the cascade-delete checkbox in ThreadDetailActions.
  // Paused until tenant is known.
  const [{ data: attachedData }] = useQuery<{
    artifacts?: Array<{
      id: string;
      title: string;
      type?: string | null;
    }> | null;
  }>({
    query: ThreadArtifactsQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const attachedArtifacts = useMemo(
    () =>
      (attachedData?.artifacts ?? []).map((a) => ({
        id: a.id,
        title: a.title,
      })),
    [attachedData?.artifacts],
  );
  const [{ data: mentionTargetsData }, reexecuteMentionTargetsQuery] =
    useQuery<MentionTargetsResult>({
      query: ThreadMentionTargetsQuery,
      variables: { threadId },
      pause: !threadId,
      requestPolicy: "cache-and-network",
    });

  const computerId = routeThread?.computerId ?? null;
  const [{ data: tasksData }, reexecuteTasksQuery] =
    useQuery<ThreadTasksResult>({
      query: ComputerThreadTasksQuery,
      variables: { computerId, threadId, limit: 6 },
      pause: !computerId,
    });
  const [{ data: eventsData }, reexecuteEventsQuery] =
    useQuery<ThreadEventsResult>({
      query: ComputerEventsQuery,
      variables: { computerId, limit: 100 },
      pause: !computerId,
    });
  const [{ data: runbookRunsData }, reexecuteRunbookRunsQuery] =
    useQuery<RunbookRunsResult>({
      query: RunbookRunsQuery,
      variables: { computerId, threadId, limit: 5 },
      pause: !computerId,
      requestPolicy: "cache-and-network",
    });
  const [
    {
      data: linkedTasksData,
      fetching: linkedTasksFetching,
      error: linkedTasksError,
    },
    reexecuteLinkedTasksQuery,
  ] = useQuery<ThreadLinkedTasksResult>({
    query: ThreadLinkedTasksQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const [{ fetching: completingThread }, updateThread] =
    useMutation(UpdateThreadMutation);
  const {
    chunks,
    streamState,
    reset: resetStreamingChunks,
  } = useComputerThreadChunks(threadId);

  // Plan-012 U8: instantiate the useChat AppSync transport adapter for
  // this thread. Adapter lives parallel to the legacy subscription
  // wiring above — once U13 (composer migration) consumes it as the
  // sole submit owner, the legacy SendMessageMutation invocations from
  // composers retire. The adapter is constructed eagerly here so smoke
  // pins (transportStatus) can be inspected from devtools while the
  // cutover is in flight; it has no side effects until sendMessages
  // is called.
  const urqlClient = useClient();
  const _appSyncChatTransport = useMemo(
    () =>
      threadId ? createAppSyncChatTransport({ urqlClient, threadId }) : null,
    [urqlClient, threadId],
  );
  const [{ data: turnUpdate }] = useSubscription<{
    onThreadTurnUpdated?: { threadId?: string | null } | null;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [{ data: threadUpdate }] = useSubscription<{
    onThreadUpdated?: { threadId?: string | null } | null;
  }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [{ data: messageUpdate }] = useSubscription<{
    onNewMessage?: {
      threadId?: string | null;
      messageId?: string | null;
    } | null;
  }>({
    query: NewMessageSubscription,
    variables: { threadId },
    pause: !threadId,
  });

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    threadId,
    turnUpdate?.onThreadTurnUpdated?.threadId,
  ]);

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    threadId,
    threadUpdate?.onThreadUpdated?.threadId,
  ]);

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteMentionTargetsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteMentionTargetsQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    threadId,
  ]);

  useEffect(() => {
    if (
      optimisticMessage &&
      hasPersistedUserMessage(routeThread?.messages?.edges, optimisticMessage)
    ) {
      setOptimisticMessage(null);
    }
  }, [routeThread?.messages?.edges, optimisticMessage]);

  useEffect(() => {
    function handleRunbookDecision() {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }

    window.addEventListener(
      "thinkwork:runbook-decision",
      handleRunbookDecision,
    );
    return () =>
      window.removeEventListener(
        "thinkwork:runbook-decision",
        handleRunbookDecision,
      );
  }, [
    reexecuteEventsQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
  ]);

  const thread = routeThread ? toTaskThread(routeThread) : null;
  if (thread) {
    thread.turns = toTaskThreadTurns(
      tasksData?.computerTasks,
      eventsData?.computerEvents,
    );
  }
  const visibleThread = optimisticMessage
    ? withOptimisticUserTurn(thread, optimisticMessage)
    : thread;
  const threadArtifacts = useMemo(
    () => deriveThreadArtifacts(visibleThread),
    [visibleThread],
  );
  const effectiveSelectedArtifactId = resolveThreadArtifactSelection(
    threadArtifacts,
    selectedArtifactId,
  );
  const runbookQueues = useMemo(
    () => toRunbookQueues(runbookRunsData?.runbookRuns),
    [runbookRunsData?.runbookRuns],
  );
  const hasActiveRunbookQueue = runbookQueues.some((queue) =>
    isActiveRunbookQueue(queue.status),
  );
  const hasDurableAssistant = hasDurableAssistantAfterLatestUser(visibleThread);
  const linkedTasks = linkedTasksData?.threadLinkedTasks ?? [];
  const isCustomerOnboardingThread =
    hasCustomerOnboardingMetadata(data?.thread?.metadata) ||
    linkedTasks.length > 0;
  const showOnboardingChecklist =
    isCustomerOnboardingThread || linkedTasksFetching;
  const completionNotificationRef = useRef<{
    threadId: string;
    hasDurableAssistant: boolean;
  } | null>(null);

  useEffect(() => {
    if (hasDurableAssistant) {
      resetStreamingChunks();
    }
  }, [hasDurableAssistant, resetStreamingChunks]);

  useEffect(() => {
    const previous = completionNotificationRef.current;
    completionNotificationRef.current = { threadId, hasDurableAssistant };

    if (
      !visibleThread ||
      previous?.threadId !== threadId ||
      previous.hasDurableAssistant ||
      !hasDurableAssistant
    ) {
      return;
    }

    void notifyAgentCompletion({
      title: "Agent finished",
      body: visibleThread.title
        ? `${visibleThread.title} is ready.`
        : "Thread response is ready.",
    });
  }, [hasDurableAssistant, threadId, visibleThread]);

  useEffect(() => {
    if (selectedArtifactId !== effectiveSelectedArtifactId) {
      setSelectedArtifactId(effectiveSelectedArtifactId);
    }
    if (threadArtifacts.length === 0 && artifactPanelOpen) {
      setArtifactPanelOpen(false);
    }
    if (
      (!artifactPanelOpen || threadArtifacts.length === 0) &&
      artifactFullscreen
    ) {
      setArtifactFullscreen(false);
    }
  }, [
    artifactFullscreen,
    artifactPanelOpen,
    effectiveSelectedArtifactId,
    selectedArtifactId,
    threadArtifacts.length,
  ]);

  const artifactPanelState = useMemo(
    () => ({
      artifacts: threadArtifacts,
      selectedArtifactId: effectiveSelectedArtifactId,
      isOpen: artifactPanelOpen,
      isFullscreen: artifactFullscreen,
      onOpenChange: (open: boolean) => {
        setArtifactPanelOpen(open);
        if (!open) {
          setArtifactFullscreen(false);
        }
        if (open) {
          setThreadInfoOpen(false);
        }
      },
      onSelectArtifact: (artifactId: string) => {
        if (!threadArtifacts.some((artifact) => artifact.id === artifactId)) {
          return;
        }
        setSelectedArtifactId(artifactId);
        setArtifactPanelOpen(true);
        setThreadInfoOpen(false);
      },
    }),
    [
      artifactFullscreen,
      artifactPanelOpen,
      effectiveSelectedArtifactId,
      threadArtifacts,
    ],
  );
  const threadInfoPanelState = useMemo<TaskThreadInfoPanelState>(
    () => ({
      isOpen: threadInfoOpen,
      onOpenChange: (open: boolean) => {
        setThreadInfoOpen(open);
        if (open) {
          setArtifactPanelOpen(false);
          setArtifactFullscreen(false);
        }
      },
      startedAt: routeThread?.createdAt ?? null,
      startedBy: resolveStartedBy(routeThread),
      agents: resolveAgentsInvolved(routeThread),
      attachments: routeThread?.attachments ?? [],
      onDownloadAttachment: (attachmentId: string) =>
        downloadThreadAttachment(threadId, attachmentId),
      checklist: showOnboardingChecklist
        ? {
            title: "Progress",
            tasks: linkedTasks,
            isLoading: linkedTasksFetching && linkedTasks.length === 0,
            error: linkedTasksError?.message ?? null,
            completedAt:
              normalizeThreadStatus(routeThread?.status) === "done"
                ? routeThread?.updatedAt
                : null,
            isCompleting: completingThread,
            onCompleteThread: handleCompleteThread,
          }
        : null,
    }),
    [
      routeThread,
      linkedTasks,
      linkedTasksError?.message,
      linkedTasksFetching,
      showOnboardingChecklist,
      threadId,
      threadInfoOpen,
      completingThread,
    ],
  );

  usePageHeaderActions({
    backHref,
    title: threadTitle,
    // Tab title gets the "Thread · " prefix to match the section pattern
    // used by Memory and other pages ("Memory · ThinkWork", etc.). The
    // in-page header keeps the bare thread title — no need to repeat
    // "Thread" inside the page the user is already on.
    documentTitle: `${documentTitlePrefix} · ${threadTitle}`,
    action: (
      <div className="flex items-center gap-2">
        <ThreadDetailActions
          threadId={threadId}
          threadTitle={threadTitle}
          attachedArtifacts={attachedArtifacts}
          onDeleted={() => {
            // ChatSidebar owns post-delete navigation because it has the
            // actual visible, filtered thread order the user is looking at.
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={threadInfoOpen ? "Close thread info" : "Open thread info"}
          title={threadInfoOpen ? "Close thread info" : "Open thread info"}
          className={threadInfoOpen ? undefined : "text-muted-foreground"}
          onClick={() => {
            const nextOpen = !threadInfoOpen;
            setThreadInfoOpen(nextOpen);
            if (nextOpen) {
              setArtifactPanelOpen(false);
              setArtifactFullscreen(false);
            }
          }}
        >
          <Info className="size-4" />
        </Button>
        {artifactPanelOpen && effectiveSelectedArtifactId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              artifactFullscreen
                ? "Minimize artifact panel"
                : "Maximize artifact panel"
            }
            title={
              artifactFullscreen
                ? "Minimize artifact panel"
                : "Maximize artifact panel"
            }
            className={
              artifactFullscreen ? "text-primary" : "text-muted-foreground"
            }
            onClick={() => {
              setArtifactFullscreen((current) => !current);
            }}
          >
            {artifactFullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        ) : null}
        {effectiveSelectedArtifactId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              artifactPanelOpen
                ? "Close artifact side panel"
                : "Open artifact side panel"
            }
            title={
              artifactPanelOpen
                ? "Close artifact side panel"
                : "Open artifact side panel"
            }
            className={
              artifactPanelOpen ? "text-primary" : "text-muted-foreground"
            }
            onClick={() => {
              const nextOpen = !artifactPanelOpen;
              setArtifactPanelOpen(nextOpen);
              if (!nextOpen) {
                setArtifactFullscreen(false);
              }
              if (nextOpen) {
                setThreadInfoOpen(false);
              }
            }}
          >
            <PanelRight className="size-4" />
          </Button>
        ) : null}
      </div>
    ),
    actionKey: `thread-actions:${threadId}:${attachedArtifacts.length}:${threadArtifacts.length}:${effectiveSelectedArtifactId ?? ""}:${threadInfoOpen ? "info-open" : "info-closed"}:${artifactPanelOpen ? "open" : "closed"}:${artifactFullscreen ? "fullscreen" : "normal"}`,
  });

  useEffect(() => {
    if (!computerId || !hasActiveRunbookQueue) return;
    const interval = window.setInterval(() => {
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [
    computerId,
    hasActiveRunbookQueue,
    reexecuteEventsQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
  ]);

  async function handleCompleteThread() {
    const result = await updateThread({
      id: threadId,
      input: { status: "DONE" },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Thread completed");
    reexecuteQuery({ requestPolicy: "network-only" });
    reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
  }

  const threadView = (
    <TaskThreadView
      thread={visibleThread}
      isLoading={fetching || hasMismatchedThreadData}
      error={error?.message ?? null}
      streamingChunks={hasDurableAssistant ? [] : chunks}
      streamState={hasDurableAssistant ? undefined : streamState}
      isSending={sending}
      mentionTargets={mentionTargetsData?.threadMentionTargets ?? []}
      artifactPanelState={artifactPanelState}
      infoPanelState={threadInfoPanelState}
      onSendFollowUp={async (content, files, mentions = []) => {
        setOptimisticMessage(content);
        resetStreamingChunks();

        // U1 of finance pilot: upload attached files before the
        // sendMessage mutation so the resulting attachmentId references
        // are embedded in `metadata.attachments`. The Strands turn
        // (U3) reads that list at dispatch and stages files to /tmp
        // before the model loop. Partial-success: any failed upload
        // surfaces inline; the message still sends so the user isn't
        // blocked.
        const apiUrl = import.meta.env.VITE_API_URL || "";
        let attachmentRefs: { attachmentId: string }[] = [];
        if (files && files.length > 0 && apiUrl) {
          const token = await getIdToken();
          if (!token) {
            setOptimisticMessage(null);
            throw new Error("Sign-in required to upload attachments");
          }
          const result = await uploadThreadAttachments({
            endpoints: { apiUrl, token },
            threadId,
            files,
          });
          attachmentRefs = result.uploaded.map((a) => ({
            attachmentId: a.attachmentId,
          }));
          if (result.failures.length > 0) {
            console.warn(
              "[ComputerThreadDetail] attachment upload failures:",
              result.failures,
            );
          }
        }

        const sendInput: {
          threadId: string;
          role: "USER";
          content: string;
          metadata?: string;
          mentions?: Array<{
            targetType: "USER" | "AGENT";
            targetId: string;
            displayName: string;
            rawText: string;
          }>;
        } = {
          threadId,
          role: "USER",
          content,
        };
        if (attachmentRefs.length > 0) {
          sendInput.metadata = JSON.stringify({ attachments: attachmentRefs });
        }
        if (mentions.length > 0) {
          sendInput.mentions = mentions.map(toSendMention);
        }
        const result = await sendMessage({ input: sendInput });
        if (result.error) {
          setOptimisticMessage(null);
          throw result.error;
        }
        reexecuteQuery({ requestPolicy: "network-only" });
        reexecuteTasksQuery({ requestPolicy: "network-only" });
        reexecuteEventsQuery({ requestPolicy: "network-only" });
        reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
        reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      }}
      runbookQueues={runbookQueues}
    />
  );

  return threadView;
}

export function deriveThreadArtifacts(
  thread: TaskThread | null,
): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];
  const seen = new Set<string>();
  for (const message of thread?.messages ?? []) {
    const artifact = message.durableArtifact;
    if (!artifact || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    artifacts.push(artifact);
  }
  return artifacts;
}

export function resolveThreadArtifactSelection(
  artifacts: GeneratedArtifact[],
  currentArtifactId: string | null,
) {
  if (
    currentArtifactId &&
    artifacts.some((artifact) => artifact.id === currentArtifactId)
  ) {
    return currentArtifactId;
  }
  return artifacts.at(-1)?.id ?? null;
}

function toSendMention(mention: ComposerMention) {
  return {
    targetType: mention.targetType,
    targetId: mention.targetId,
    displayName: mention.displayName,
    rawText: mention.rawText,
  };
}

function resolveStartedBy(thread?: ThreadResult["thread"]) {
  if (!thread) return null;
  const firstUserMessage = thread.messages?.edges?.find(
    ({ node }) => node.role.toUpperCase() === "USER",
  )?.node;
  return (
    firstUserMessage?.sender?.displayName?.trim() ||
    thread.user?.name?.trim() ||
    thread.user?.email?.trim() ||
    thread.userId ||
    null
  );
}

function resolveAgentsInvolved(thread?: ThreadResult["thread"]) {
  if (!thread) return [];
  const agents = new Set<string>();
  for (const { node } of thread.messages?.edges ?? []) {
    for (const mention of node.mentions ?? []) {
      if (mention.targetType?.toUpperCase() !== "AGENT") continue;
      const label = mention.displayName?.trim();
      if (label) agents.add(label);
    }
    if (node.role.toUpperCase() !== "USER") {
      const label = node.sender?.displayName?.trim();
      if (label) agents.add(label);
    }
  }
  const computerName = thread.computer?.name?.trim() || thread.computer?.slug;
  if (computerName) agents.add(computerName);
  return Array.from(agents);
}

function hasCustomerOnboardingMetadata(metadata: unknown) {
  const root = parseSpaceRecord(metadata);
  const onboarding = parseSpaceRecord(root.customerOnboarding);
  return onboarding.workflow === "customer_onboarding";
}

function normalizeThreadStatus(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function downloadThreadAttachment(
  threadId: string,
  attachmentId: string,
) {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const token = await getIdToken();
  if (!apiUrl || !token) {
    toast.error("Sign-in required to download attachments.");
    return;
  }

  try {
    const res = await fetch(
      `${apiUrl}/api/threads/${threadId}/attachments/${attachmentId}/download`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`download endpoint returned ${res.status}`);
    }
    const body = (await res.json()) as { url?: string };
    if (!body.url) {
      throw new Error("download endpoint returned no url");
    }
    window.open(body.url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(
      `Could not download attachment: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
  }
}

function withOptimisticUserTurn(
  thread: TaskThread | null,
  content: string,
): TaskThread | null {
  if (!thread) return null;
  const alreadyPersisted = thread.messages.some(
    (message) =>
      message.role.toUpperCase() === "USER" &&
      message.content?.trim() === content.trim(),
  );
  if (alreadyPersisted) return thread;

  return {
    ...thread,
    messages: [
      ...thread.messages,
      {
        id: "optimistic-user-message",
        role: "USER",
        content,
      },
    ],
    turns: [
      {
        id: "optimistic-computer-turn",
        status: "running",
        invocationSource: "chat_message",
        startedAt: new Date().toISOString(),
      },
      ...(thread.turns ?? []),
    ],
  };
}

function toTaskThread(thread: NonNullable<ThreadResult["thread"]>): TaskThread {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    lifecycleStatus: thread.lifecycleStatus,
    costSummary: thread.costSummary,
    messages: (thread.messages?.edges ?? []).map(({ node }) => ({
      id: node.id,
      role: node.role,
      content: node.content,
      parts: normalizePersistedParts(node.parts),
      createdAt: node.createdAt,
      metadata: node.metadata,
      toolCalls: node.toolCalls,
      toolResults: node.toolResults,
      durableArtifact: node.durableArtifact
        ? {
            id: node.durableArtifact.id,
            title: node.durableArtifact.title,
            type: node.durableArtifact.type,
            summary: node.durableArtifact.summary,
            metadata: metadataObject(node.durableArtifact.metadata),
          }
        : null,
    })),
  };
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toTaskThreadTurns(
  tasks: ThreadTasksResult["computerTasks"],
  events: ThreadEventsResult["computerEvents"],
) {
  const eventsByTaskId = new Map<
    string,
    NonNullable<ThreadEventsResult["computerEvents"]>
  >();
  for (const event of events ?? []) {
    if (!event.taskId) continue;
    const taskEvents = eventsByTaskId.get(event.taskId) ?? [];
    taskEvents.push(event);
    eventsByTaskId.set(event.taskId, taskEvents);
  }

  return (tasks ?? []).map((task) => {
    const input = metadataObject(task.input) ?? {};
    const output = metadataObject(task.output) ?? {};
    return {
      id: task.id,
      status: task.status,
      invocationSource: stringValue(input.source) ?? "chat_message",
      startedAt: task.claimedAt ?? task.createdAt,
      finishedAt: task.completedAt,
      model: stringValue(output.model),
      usageJson: output.usage,
      resultJson: output,
      error: taskErrorMessage(task.error),
      events: (eventsByTaskId.get(task.id) ?? []).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        level: event.level,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    };
  });
}

function toRunbookQueues(runs: RunbookRunsResult["runbookRuns"]) {
  return (runs ?? []).map((run) => {
    const displayName =
      runbookDisplayName(run.definitionSnapshot) ??
      stringValue(run.runbookSlug)?.replace(/-/g, " ") ??
      "Runbook";
    const phaseOrder = new Map<string, number>();
    const phases = new Map<
      string,
      {
        id: string;
        title: string;
        tasks: Array<{
          id: string;
          key?: string;
          taskKey?: string;
          title?: string;
          summary?: string;
          status?: string;
          dependsOn?: unknown;
          capabilityRoles?: unknown;
          sortOrder?: number;
        }>;
      }
    >();

    for (const task of run.tasks ?? []) {
      const phaseId = stringValue(task.phaseId) ?? "runbook";
      if (!phaseOrder.has(phaseId)) phaseOrder.set(phaseId, phaseOrder.size);
      const phase = phases.get(phaseId) ?? {
        id: phaseId,
        title: stringValue(task.phaseTitle) ?? "Runbook",
        tasks: [],
      };
      phase.tasks.push({
        id: task.id,
        key: stringValue(task.taskKey) ?? undefined,
        taskKey: stringValue(task.taskKey) ?? undefined,
        title: stringValue(task.title) ?? undefined,
        summary: stringValue(task.summary) ?? undefined,
        status: stringValue(task.status) ?? undefined,
        dependsOn: task.dependsOn,
        capabilityRoles: task.capabilityRoles,
        sortOrder: task.sortOrder ?? undefined,
      });
      phases.set(phaseId, phase);
    }

    const sortedPhases = [...phases.values()]
      .sort((a, b) => (phaseOrder.get(a.id) ?? 0) - (phaseOrder.get(b.id) ?? 0))
      .map((phase) => ({
        ...phase,
        tasks: phase.tasks.sort(
          (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        ),
      }));

    return {
      runbookRunId: run.id,
      runbookSlug: stringValue(run.runbookSlug) ?? undefined,
      runbookVersion: stringValue(run.runbookVersion) ?? undefined,
      displayName,
      status: stringValue(run.status) ?? undefined,
      phases: sortedPhases,
    };
  });
}

function isActiveRunbookQueue(status: unknown) {
  const normalized = stringValue(status)?.toLowerCase().replace(/_/g, "-");
  return Boolean(
    normalized &&
      !["completed", "failed", "error", "cancelled", "rejected"].includes(
        normalized,
      ),
  );
}

function runbookDisplayName(definitionSnapshot: unknown) {
  const definition = metadataObject(definitionSnapshot);
  const catalog = metadataObject(definition?.catalog);
  return stringValue(catalog?.displayName);
}

function taskErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const record = metadataObject(value);
  return stringValue(record?.message) ?? stringValue(record?.code);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasPersistedUserMessage(
  edges:
    | Array<{ node: { role: string; content?: string | null } }>
    | undefined
    | null,
  content: string,
) {
  return (edges ?? []).some(
    ({ node }) =>
      node.role.toUpperCase() === "USER" &&
      node.content?.trim() === content.trim(),
  );
}

function hasDurableAssistantAfterLatestUser(thread: TaskThread | null) {
  if (!thread) return false;
  const latestUserIndex = findLastIndex(
    thread.messages,
    (message) => message.role.toUpperCase() === "USER",
  );
  if (latestUserIndex < 0) return false;
  return thread.messages
    .slice(latestUserIndex + 1)
    .some((message) => message.role.toUpperCase() === "ASSISTANT");
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
