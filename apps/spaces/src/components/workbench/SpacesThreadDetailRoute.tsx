import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useClient, useMutation, useQuery, useSubscription } from "urql";
import { Info, Maximize2, Minimize2, PanelRight } from "lucide-react";
import { IconFiles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import {
  parseSpaceRecord,
  type LinkedTaskSummary,
} from "@/components/spaces/space-types";
import { spaceCrumbLabel } from "@/components/spaces/space-utils";
import {
  TaskThreadView,
  normalizePersistedParts,
  type ComposerMention,
  type TaskThread,
  type TaskThreadTurn,
  type ThreadInfoChecklistTask,
  type ThreadInfoGoalRecord,
  type ThreadInfoGoalRecordGroup,
  type TaskThreadInfoPanelState,
} from "@/components/workbench/TaskThreadView";
import type { GeneratedArtifact } from "@/components/workbench/GeneratedArtifactCard";
import { ThreadDetailActions } from "@/components/workbench/ThreadDetailActions";
import { ThreadTitleInlineRename } from "@/components/workbench/ThreadTitleInlineRename";
import { ThreadWorkspaceView } from "@/components/workbench/ThreadWorkspaceView";
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
  ThreadGoalFilesQuery,
  ThreadLinkedTasksQuery,
  ThreadProgressMarkdownQuery,
  ThreadMentionTargetsQuery,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
  RefreshThreadProgressMutation,
  ReviewGoalMutation,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import { createAppSyncChatTransport } from "@/lib/use-chat-appsync-transport";
import {
  clearPendingThreadStart,
  getPendingThreadStart,
  type PendingThreadStart,
} from "@/lib/pending-thread-starts";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { notifyAgentCompletion } from "@/lib/desktop-notifications";
import { apiFetch } from "@/lib/api-fetch";
import {
  desktopToolbarActiveButtonClassName,
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";

interface SpacesThreadDetailRouteProps {
  threadId: string;
  backHref?: string;
  documentTitlePrefix?: string;
}

interface OptimisticMessage {
  content: string;
  expectAssistantResponse: boolean;
}

interface ThreadResult {
  thread: {
    id: string;
    identifier?: string | null;
    agentId?: string | null;
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
    space?: {
      id: string;
      name?: string | null;
      slug?: string | null;
    } | null;
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

interface ThreadProgressMarkdownResult {
  threadProgressMarkdown?: {
    threadId: string;
    key?: string | null;
    content: string;
  } | null;
}

interface ThreadGoalFilesResult {
  threadGoalFiles?: {
    goal: {
      id: string;
      outcome?: string | null;
      ownerType?: string | null;
      ownerId?: string | null;
      mode?: string | null;
      status?: string | null;
      completionRule?: unknown;
      reviewPolicy?: unknown;
      reviewerType?: string | null;
      reviewerId?: string | null;
      startedAt?: string | null;
      reviewedAt?: string | null;
      completedAt?: string | null;
      cancelledAt?: string | null;
      metadata?: unknown;
      updatedAt?: string | null;
    };
    files: Array<{
      file: string;
      key?: string | null;
      content?: string | null;
    }>;
  } | null;
}

interface ThreadTurnRow {
  id: string;
  thread_id?: string | null;
  trigger_id?: string | null;
  agent_id?: string | null;
  invocation_source?: string | null;
  runtime_type?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  system_prompt?: string | null;
  result_json?: unknown;
  usage_json?: unknown;
  context_snapshot?: unknown;
  created_at?: string | null;
}

export function SpacesThreadDetailRoute({
  threadId,
  backHref,
  documentTitlePrefix = "Thread",
}: SpacesThreadDetailRouteProps) {
  const { tenantId, userId } = useTenant();
  const [optimisticMessage, setOptimisticMessage] =
    useState<OptimisticMessage | null>(null);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [threadInfoOpen, setThreadInfoOpen] = useState(false);
  const [filesModeOpen, setFilesModeOpen] = useState(false);
  const [goalReviewError, setGoalReviewError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const [manualRefreshStartedAt, setManualRefreshStartedAt] = useState<
    number | null
  >(null);
  const [manualRefreshObservedFetching, setManualRefreshObservedFetching] =
    useState(false);
  const [threadTurnRows, setThreadTurnRows] = useState<ThreadTurnRow[]>([]);
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id: threadId, messageLimit: 100 },
  });
  const fallbackThreadTitle = useRouterState({
    select: (state) =>
      threadTitleFallbackFromState(state.location.state, threadId),
  });
  const optimisticThreadStart = getPendingThreadStart(threadId);
  const routeThread = data?.thread?.id === threadId ? data.thread : null;
  const hasMismatchedThreadData = Boolean(data?.thread && !routeThread);
  const isThreadTitlePending =
    (fetching && !optimisticThreadStart) || hasMismatchedThreadData;
  const threadTitle =
    routeThread?.title?.trim() ||
    fallbackThreadTitle ||
    optimisticThreadStart?.title ||
    (isThreadTitlePending ? "Loading..." : "Thread");

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
  const [
    { data: mentionTargetsData, fetching: mentionTargetsFetching },
    reexecuteMentionTargetsQuery,
  ] = useQuery<MentionTargetsResult>({
    query: ThreadMentionTargetsQuery,
    variables: { threadId },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });

  const computerId = routeThread?.computerId ?? null;
  const [{ data: tasksData, fetching: tasksFetching }, reexecuteTasksQuery] =
    useQuery<ThreadTasksResult>({
      query: ComputerThreadTasksQuery,
      variables: { computerId, threadId, limit: 6 },
      pause: !computerId,
    });
  const [{ data: eventsData, fetching: eventsFetching }, reexecuteEventsQuery] =
    useQuery<ThreadEventsResult>({
      query: ComputerEventsQuery,
      variables: { computerId, limit: 100 },
      pause: !computerId,
    });
  const [
    { data: runbookRunsData, fetching: runbookRunsFetching },
    reexecuteRunbookRunsQuery,
  ] = useQuery<RunbookRunsResult>({
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
  const [
    {
      data: progressMarkdownData,
      fetching: progressMarkdownFetching,
      error: progressMarkdownError,
    },
    reexecuteProgressMarkdownQuery,
  ] = useQuery<ThreadProgressMarkdownResult>({
    query: ThreadProgressMarkdownQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: goalFilesData, fetching: goalFilesFetching, error: goalFilesError },
    reexecuteGoalFilesQuery,
  ] = useQuery<ThreadGoalFilesResult>({
    query: ThreadGoalFilesQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId || !threadId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const [{ fetching: completingThread }, updateThread] =
    useMutation(UpdateThreadMutation);
  const [{ fetching: reviewingGoal }, reviewGoal] =
    useMutation(ReviewGoalMutation);
  const [{ fetching: refreshingProgress }, refreshThreadProgress] = useMutation(
    RefreshThreadProgressMutation,
  );
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

  const refreshThreadTurns = useCallback(async () => {
    if (!tenantId || !threadId) {
      setThreadTurnRows([]);
      return;
    }
    try {
      const rows = await apiFetch<ThreadTurnRow[]>(
        `/api/thread-turns?limit=50&thread_id=${encodeURIComponent(threadId)}`,
        { extraHeaders: { "x-tenant-id": tenantId } },
      );
      setThreadTurnRows(rows);
    } catch {
      setThreadTurnRows([]);
    }
  }, [tenantId, threadId]);

  useEffect(() => {
    void refreshThreadTurns();
  }, [refreshThreadTurns]);

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
      reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      void refreshThreadTurns();
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    refreshThreadTurns,
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
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      void refreshThreadTurns();
    }
  }, [
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    refreshThreadTurns,
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
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      void refreshThreadTurns();
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteEventsQuery,
    reexecuteLinkedTasksQuery,
    reexecuteMentionTargetsQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    refreshThreadTurns,
    threadId,
  ]);

  useEffect(() => {
    if (
      optimisticMessage &&
      hasPersistedUserMessage(
        routeThread?.messages?.edges,
        optimisticMessage.content,
      )
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

  const thread = routeThread
    ? toTaskThread(routeThread)
    : optimisticThreadStart
      ? toOptimisticTaskThread(optimisticThreadStart)
      : null;
  const threadTurns = [
    ...toTaskThreadTurns(tasksData?.computerTasks, eventsData?.computerEvents),
    ...toTaskThreadTurnsFromRows(threadTurnRows),
  ];
  if (thread) {
    thread.turns = threadTurns;
  }
  const hasPersistedPendingStartUserMessage = optimisticThreadStart
    ? hasPersistedUserMessage(
        routeThread?.messages?.edges,
        optimisticThreadStart.content,
      )
    : false;
  const hasPendingStartRealActivity = Boolean(
    optimisticThreadStart &&
      (optimisticThreadStart.expectAssistantResponse === false ||
        threadTurns.length > 0 ||
        hasDurableAssistantAfterLatestUser(thread)),
  );
  const shouldKeepPendingStartSignal = Boolean(
    optimisticThreadStart && !hasPendingStartRealActivity,
  );

  useEffect(() => {
    if (
      optimisticThreadStart &&
      hasPersistedPendingStartUserMessage &&
      hasPendingStartRealActivity
    ) {
      clearPendingThreadStart(threadId);
    }
  }, [
    hasPendingStartRealActivity,
    hasPersistedPendingStartUserMessage,
    optimisticThreadStart,
    threadId,
  ]);

  const routeStateOptimisticMessage =
    optimisticThreadStart &&
    (!hasPersistedPendingStartUserMessage || shouldKeepPendingStartSignal)
      ? {
          content: optimisticThreadStart.content,
          expectAssistantResponse:
            optimisticThreadStart.expectAssistantResponse,
        }
      : null;
  const effectiveOptimisticMessage =
    optimisticMessage ?? routeStateOptimisticMessage;
  const visibleThread = effectiveOptimisticMessage
    ? withOptimisticUserTurn(thread, effectiveOptimisticMessage.content, {
        expectAssistantResponse:
          effectiveOptimisticMessage.expectAssistantResponse,
      })
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
  const isManualRefreshFetching =
    fetching ||
    mentionTargetsFetching ||
    tasksFetching ||
    eventsFetching ||
    runbookRunsFetching ||
    linkedTasksFetching ||
    progressMarkdownFetching ||
    goalFilesFetching ||
    refreshingProgress;
  const handleRefreshThread = useCallback(async () => {
    setManualRefreshStartedAt(Date.now());
    setManualRefreshObservedFetching(false);
    if (tenantId) {
      const result = await refreshThreadProgress({
        input: { tenantId, threadId },
      });
      if (result.error) {
        toast.error(result.error.message);
      }
    }
    reexecuteQuery({ requestPolicy: "network-only" });
    reexecuteTasksQuery({ requestPolicy: "network-only" });
    reexecuteEventsQuery({ requestPolicy: "network-only" });
    reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
    reexecuteMentionTargetsQuery({ requestPolicy: "network-only" });
    reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
    reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
    reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
  }, [
    reexecuteEventsQuery,
    reexecuteGoalFilesQuery,
    reexecuteLinkedTasksQuery,
    reexecuteMentionTargetsQuery,
    reexecuteProgressMarkdownQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    refreshThreadProgress,
    tenantId,
    threadId,
  ]);
  const hasDurableAssistant = hasDurableAssistantAfterLatestUser(visibleThread);
  const linkedTasks = linkedTasksData?.threadLinkedTasks ?? [];
  const goalFiles = goalFilesData?.threadGoalFiles ?? null;
  const goal = goalFiles?.goal ?? null;
  const progressChecklistTasks = useMemo(
    () =>
      parseProgressMarkdownTasks(
        progressMarkdownData?.threadProgressMarkdown?.content,
      ),
    [progressMarkdownData?.threadProgressMarkdown?.content],
  );
  const infoPanelChecklistTasks =
    progressChecklistTasks.length > 0
      ? progressChecklistTasks
      : linkedTasks.map(toThreadInfoChecklistTask);
  const goalReadiness = useMemo(
    () => deriveGoalReadiness(infoPanelChecklistTasks),
    [infoPanelChecklistTasks],
  );
  const goalRecords = useMemo(
    () => summarizeGoalFiles(goalFiles?.files ?? [], threadArtifacts.length),
    [goalFiles?.files, threadArtifacts.length],
  );
  const isCustomerOnboardingThread =
    Boolean(goal) ||
    goalFilesFetching ||
    hasCustomerOnboardingMetadata(data?.thread?.metadata) ||
    linkedTasks.length > 0 ||
    Boolean(progressMarkdownData?.threadProgressMarkdown?.content);
  const showOnboardingChecklist =
    isCustomerOnboardingThread ||
    linkedTasksFetching ||
    progressMarkdownFetching ||
    goalFilesFetching;
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
    function handleDesktopRefresh(event: Event) {
      event.preventDefault();
      void handleRefreshThread();
    }

    window.addEventListener("thinkwork:desktop-refresh", handleDesktopRefresh);
    return () =>
      window.removeEventListener(
        "thinkwork:desktop-refresh",
        handleDesktopRefresh,
      );
  }, [handleRefreshThread]);

  useEffect(() => {
    if (manualRefreshStartedAt === null) return;
    if (isManualRefreshFetching) {
      setManualRefreshObservedFetching(true);
      return;
    }

    const minimumSpinMs = manualRefreshObservedFetching ? 250 : 400;
    const elapsedMs = Date.now() - manualRefreshStartedAt;
    const timeout = window.setTimeout(
      () => {
        window.dispatchEvent(
          new CustomEvent("thinkwork:desktop-refresh-complete"),
        );
        setManualRefreshStartedAt(null);
        setManualRefreshObservedFetching(false);
      },
      Math.max(0, minimumSpinMs - elapsedMs),
    );
    return () => window.clearTimeout(timeout);
  }, [
    isManualRefreshFetching,
    manualRefreshObservedFetching,
    manualRefreshStartedAt,
  ]);

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
          setFilesModeOpen(false);
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
  const handleReviewGoal = useCallback(
    async (
      action: "CONFIRM_COMPLETION" | "REQUEST_CHANGES",
      notes?: string,
    ) => {
      if (!tenantId || !goal?.id) return;
      setGoalReviewError(null);
      const result = await reviewGoal({
        input: {
          tenantId,
          goalId: goal.id,
          action,
          ...(notes ? { notes } : {}),
        },
      });
      if (result.error) {
        setGoalReviewError(result.error.message);
        toast.error(result.error.message);
        return;
      }
      toast.success(
        action === "CONFIRM_COMPLETION"
          ? "Goal completion confirmed"
          : "Goal returned for changes",
      );
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
      reexecuteProgressMarkdownQuery({ requestPolicy: "network-only" });
      reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
    },
    [
      goal?.id,
      reexecuteGoalFilesQuery,
      reexecuteLinkedTasksQuery,
      reexecuteProgressMarkdownQuery,
      reexecuteQuery,
      reviewGoal,
      tenantId,
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
          setFilesModeOpen(false);
        }
      },
      threadId: routeThread?.id ?? threadId,
      threadIdentifier: routeThread?.identifier ?? null,
      startedAt: routeThread?.createdAt ?? null,
      startedBy: resolveStartedBy(routeThread),
      agents: resolveAgentsInvolved(routeThread),
      attachments: routeThread?.attachments ?? [],
      onDownloadAttachment: (attachmentId: string) =>
        downloadThreadAttachment(threadId, attachmentId),
      goal:
        goal || goalFilesFetching || goalFilesError
          ? {
              id: goal?.id ?? null,
              outcome: goal?.outcome ?? extractGoalLine(goalFiles, "Outcome"),
              mode: goal?.mode ?? null,
              status: goal?.status ?? null,
              ownerLabel: resolveGoalOwnerLabel(goal, userId, goalFiles),
              reviewPolicyLabel: goalReviewPolicyLabel(goal?.reviewPolicy),
              reviewRequired: goalReviewRequired(goal?.reviewPolicy),
              readyForReview: goalReadiness.readyForReview,
              isLoading: goalFilesFetching && !goal,
              error: goalFilesError?.message ?? null,
              filesLoading: goalFilesFetching,
              filesError: goalFilesError?.message ?? null,
              filesPrepared: goalFiles
                ? goalFiles.files.some((file) => Boolean(file.content))
                : undefined,
              decisionsCount: goalRecords.decisions.count,
              decisionsSummary: goalRecords.decisions.summary,
              handoffsCount: goalRecords.handoffs.count,
              handoffsSummary: goalRecords.handoffs.summary,
              artifactsCount: goalRecords.artifacts.count,
              artifactsSummary: goalRecords.artifacts.summary,
              recordGroups: goalRecords.groups,
              isReviewing: reviewingGoal,
              reviewError: goalReviewError,
              onConfirmCompletion: () => handleReviewGoal("CONFIRM_COMPLETION"),
              onRequestChanges: (notes) =>
                handleReviewGoal("REQUEST_CHANGES", notes),
            }
          : null,
      checklist: showOnboardingChecklist
        ? {
            title: "Progress",
            tasks: infoPanelChecklistTasks,
            isLoading:
              (linkedTasksFetching || progressMarkdownFetching) &&
              infoPanelChecklistTasks.length === 0,
            error:
              progressMarkdownError?.message ??
              linkedTasksError?.message ??
              null,
            completedAt:
              normalizeThreadStatus(routeThread?.status) === "done"
                ? routeThread?.updatedAt
                : null,
            isCompleting: completingThread,
            isRefreshing: refreshingProgress || manualRefreshStartedAt !== null,
            onRefreshProgress: handleRefreshThread,
            onCompleteThread: goalReviewRequired(goal?.reviewPolicy)
              ? undefined
              : handleCompleteThread,
          }
        : null,
    }),
    [
      goal,
      goalFiles,
      goalFilesError,
      goalFilesFetching,
      goalRecords,
      goalReviewError,
      goalReadiness.readyForReview,
      handleRefreshThread,
      handleReviewGoal,
      routeThread,
      infoPanelChecklistTasks,
      linkedTasksError?.message,
      linkedTasksFetching,
      progressMarkdownError?.message,
      progressMarkdownFetching,
      refreshingProgress,
      manualRefreshStartedAt,
      reviewingGoal,
      showOnboardingChecklist,
      threadId,
      threadInfoOpen,
      completingThread,
      userId,
    ],
  );

  // Space breadcrumb: a clickable parent crumb (the thread's Space) before the
  // thread title, navigating to that Space's scoped thread list — mirroring the
  // sidebar's "Thread list" action. The final crumb hosts the inline-rename
  // titleContent (see AppTopBar/DesktopApplicationHeader). Degrades to the
  // title-only header when the thread has no resolved space yet (R4).
  const spaceLabel = spaceCrumbLabel(routeThread?.space ?? null);
  const spaceBreadcrumbs = routeThread?.spaceId
    ? [
        {
          label: spaceLabel,
          href: "/threads",
          search: { spaceId: routeThread.spaceId, spaceName: spaceLabel },
        },
        { label: threadTitle },
      ]
    : undefined;

  usePageHeaderActions({
    backHref,
    title: threadTitle,
    breadcrumbs: spaceBreadcrumbs,
    // Tab title gets the "Thread · " prefix to match the section pattern
    // used by Memory and other pages ("Memory · ThinkWork", etc.). The
    // in-page header keeps the bare thread title — no need to repeat
    // "Thread" inside the page the user is already on.
    documentTitle: `${documentTitlePrefix} · ${threadTitle}`,
    titleContent: routeThread ? (
      <ThreadTitleInlineRename
        threadId={threadId}
        title={threadTitle}
        className="min-w-0 max-w-[min(28rem,55vw)]"
        textClassName="text-sm font-medium"
        inputClassName="h-7 min-w-[12rem]"
        onRenamed={() => reexecuteQuery({ requestPolicy: "network-only" })}
      />
    ) : undefined,
    titleTrailing: (
      <ThreadDetailActions
        threadId={threadId}
        threadTitle={threadTitle}
        attachedArtifacts={attachedArtifacts}
        turns={thread?.turns ?? []}
        onDeleted={() => {
          // ChatSidebar owns post-delete navigation because it has the
          // actual visible, filtered thread order the user is looking at.
        }}
      />
    ),
    action: (
      <div className={`flex items-center ${desktopToolbarGapClassName}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            filesModeOpen ? "Close thread files" : "Open thread files"
          }
          title={filesModeOpen ? "Close thread files" : "Open thread files"}
          className={
            filesModeOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          onClick={() => {
            const nextOpen = !filesModeOpen;
            setFilesModeOpen(nextOpen);
            if (nextOpen) {
              setThreadInfoOpen(false);
              setArtifactPanelOpen(false);
              setArtifactFullscreen(false);
            }
          }}
        >
          <IconFiles className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={threadInfoOpen ? "Close thread info" : "Open thread info"}
          title={threadInfoOpen ? "Close thread info" : "Open thread info"}
          className={
            threadInfoOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          onClick={() => {
            const nextOpen = !threadInfoOpen;
            setThreadInfoOpen(nextOpen);
            if (nextOpen) {
              setFilesModeOpen(false);
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
              artifactFullscreen
                ? desktopToolbarActiveButtonClassName
                : desktopToolbarButtonClassName
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
              artifactPanelOpen
                ? desktopToolbarActiveButtonClassName
                : desktopToolbarButtonClassName
            }
            onClick={() => {
              const nextOpen = !artifactPanelOpen;
              setArtifactPanelOpen(nextOpen);
              if (!nextOpen) {
                setArtifactFullscreen(false);
              }
              if (nextOpen) {
                setThreadInfoOpen(false);
                setFilesModeOpen(false);
              }
            }}
          >
            <PanelRight className="size-4" />
          </Button>
        ) : null}
      </div>
    ),
    actionKey: `thread-actions:${threadId}:${attachedArtifacts.length}:${threadArtifacts.length}:${effectiveSelectedArtifactId ?? ""}:${filesModeOpen ? "files-open" : "files-closed"}:${threadInfoOpen ? "info-open" : "info-closed"}:${artifactPanelOpen ? "open" : "closed"}:${artifactFullscreen ? "fullscreen" : "normal"}`,
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
    reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
  }

  const threadView = filesModeOpen ? (
    <ThreadWorkspaceView
      threadId={threadId}
      goalFiles={goalFiles?.files ?? []}
    />
  ) : (
    <TaskThreadView
      thread={visibleThread}
      isLoading={
        (fetching && !routeThread && !optimisticThreadStart) ||
        hasMismatchedThreadData
      }
      error={error?.message ?? null}
      streamingChunks={hasDurableAssistant ? [] : chunks}
      streamState={hasDurableAssistant ? undefined : streamState}
      isSending={sending}
      mentionTargets={mentionTargetsData?.threadMentionTargets ?? []}
      currentUser={{
        id: userId,
      }}
      artifactPanelState={artifactPanelState}
      infoPanelState={threadInfoPanelState}
      onSendFollowUp={async (
        content,
        files,
        mentions = [],
        agentRequested = true,
      ) => {
        setOptimisticMessage({
          content,
          expectAssistantResponse: agentRequested !== false,
        });
        resetStreamingChunks();

        // Upload attached files before sendMessage so persisted messages only
        // reference finalized thread_attachment rows. All-failed uploads block
        // the send; partial success sends only finalized files and tells the
        // user which part did not make it.
        const apiUrl = import.meta.env.VITE_API_URL || "";
        let attachmentRefs: { attachmentId: string }[] = [];
        if (files && files.length > 0) {
          if (!apiUrl) {
            setOptimisticMessage(null);
            throw new Error("Attachment upload endpoint is not configured");
          }
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
          if (attachmentRefs.length === 0 && result.failures.length > 0) {
            setOptimisticMessage(null);
            const first = result.failures[0]!;
            throw new Error(
              `Upload failed for ${first.file.name}: ${first.message}`,
            );
          }
          if (result.failures.length > 0) {
            toast.warning(
              `${result.failures.length} attachment${result.failures.length === 1 ? "" : "s"} could not be uploaded.`,
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
          agentRequested?: boolean;
          dispatchMode?: "MANAGED_DEFAULT" | "DESKTOP_LOCAL";
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
        if (agentRequested === false) {
          sendInput.agentRequested = false;
        }
        const result = await sendMessage({ input: sendInput });
        if (result.error) {
          setOptimisticMessage(null);
          if (attachmentRefs.length > 0) {
            toast.error(
              "Files uploaded, but the message did not send. Try sending the message again.",
            );
          }
          throw result.error;
        }
        const sentMessage = (
          result.data as { sendMessage?: { metadata?: unknown } } | undefined
        )?.sendMessage;
        const customerOnboardingHandled = isCustomerOnboardingChatUpdateHandled(
          sentMessage?.metadata,
        );
        if (customerOnboardingHandled) {
          setOptimisticMessage(null);
        }
        reexecuteQuery({ requestPolicy: "network-only" });
        reexecuteTasksQuery({ requestPolicy: "network-only" });
        reexecuteEventsQuery({ requestPolicy: "network-only" });
        reexecuteRunbookRunsQuery({ requestPolicy: "network-only" });
        reexecuteLinkedTasksQuery({ requestPolicy: "network-only" });
        reexecuteGoalFilesQuery({ requestPolicy: "network-only" });
        void refreshThreadTurns();
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

function toThreadInfoChecklistTask(
  task: LinkedTaskSummary,
): ThreadInfoChecklistTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    required: task.required,
    roleKey: task.roleKey,
    assigneeDisplay: task.assigneeDisplay,
    blocked: task.blocked,
    updatedAt: task.updatedAt,
  };
}

function deriveGoalReadiness(tasks: ThreadInfoChecklistTask[]) {
  const requiredTasks = tasks.filter(
    (task) =>
      task.required !== false &&
      normalizeThreadStatus(task.status) !== "not_applicable",
  );
  const completedRequired = requiredTasks.filter(
    (task) => normalizeThreadStatus(task.status) === "completed",
  ).length;
  return {
    completedRequired,
    totalRequired: requiredTasks.length,
    readyForReview:
      requiredTasks.length > 0 && completedRequired === requiredTasks.length,
  };
}

function summarizeGoalFiles(
  files: NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["files"],
  artifactFallbackCount: number,
) {
  const decisions = summarizeMarkdownList(
    goalFileContent(files, "DECISIONS"),
    "decisions",
    "Decisions",
    "DECISIONS.md",
  );
  const handoffs = summarizeMarkdownList(
    goalFileContent(files, "HANDOFFS"),
    "handoffs",
    "Handoffs",
    "HANDOFFS.md",
  );
  const artifacts = summarizeMarkdownList(
    goalFileContent(files, "ARTIFACTS"),
    "artifacts",
    "Artifacts",
    "ARTIFACTS.md",
  );
  if (artifacts.count === 0 && artifactFallbackCount > 0) {
    artifacts.count = artifactFallbackCount;
    artifacts.summary = `${artifactFallbackCount} thread artifact${artifactFallbackCount === 1 ? "" : "s"} attached`;
    artifacts.content = `- ${artifacts.summary}`;
    artifacts.items = [
      {
        id: "ARTIFACTS-0",
        type: "artifacts",
        typeLabel: "Artifacts",
        sourceFile: "Thread artifacts",
        text: artifacts.summary,
      },
    ];
  }
  return {
    decisions,
    handoffs,
    artifacts,
    groups: [
      toGoalRecordGroup(
        "decisions",
        "Decisions",
        "DECISIONS.md",
        "No decisions recorded",
        decisions,
      ),
      toGoalRecordGroup(
        "handoffs",
        "Handoffs",
        "HANDOFFS.md",
        "No handoffs recorded",
        handoffs,
      ),
      toGoalRecordGroup(
        "artifacts",
        "Artifacts",
        "ARTIFACTS.md",
        "No artifacts summarized",
        artifacts,
      ),
    ],
  };
}

function summarizeMarkdownList(
  content: string | null | undefined,
  type: ThreadInfoGoalRecord["type"],
  typeLabel: string,
  sourceFile: string,
) {
  const items = (content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(
      (line) =>
        line && !/^none\b/i.test(line) && !/^none captured yet\.?$/i.test(line),
    )
    .map((line) => line.replace(/\s+/g, " "));
  return {
    count: items.length,
    summary: items[0] ?? null,
    content: content ?? null,
    items: items.map((text, index) => ({
      id: `${sourceFile}-${index}`,
      type,
      typeLabel,
      sourceFile,
      text,
    })),
  };
}

function toGoalRecordGroup(
  id: ThreadInfoGoalRecordGroup["id"],
  label: string,
  sourceFile: string,
  emptyLabel: string,
  summary: {
    count: number;
    summary: string | null;
    content: string | null;
    items: ThreadInfoGoalRecord[];
  },
): ThreadInfoGoalRecordGroup {
  return {
    id,
    label,
    sourceFile,
    count: summary.count,
    summary: summary.summary,
    content: summary.content,
    emptyLabel,
    records: summary.items,
  };
}

function goalFileContent(
  files: NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["files"],
  kind: string,
) {
  return files.find((file) => file.file?.toUpperCase() === kind)?.content;
}

function extractGoalLine(
  goalFiles: ThreadGoalFilesResult["threadGoalFiles"] | null,
  label: string,
) {
  const content = goalFiles ? goalFileContent(goalFiles.files, "GOAL") : null;
  if (!content) return null;
  const pattern = new RegExp(`^${label}:\\s*(.+?)\\s*$`, "im");
  return content.match(pattern)?.[1]?.trim() ?? null;
}

function resolveGoalOwnerLabel(
  goal:
    | NonNullable<ThreadGoalFilesResult["threadGoalFiles"]>["goal"]
    | null
    | undefined,
  userId: string | null,
  goalFiles: ThreadGoalFilesResult["threadGoalFiles"] | null,
) {
  const ownerType = goal?.ownerType?.toUpperCase();
  if (ownerType === "USER" && goal?.ownerId) {
    return userId && goal.ownerId === userId ? "You" : goal.ownerId;
  }
  const ownerLine = extractGoalLine(goalFiles, "Owner");
  return ownerLine ?? "Customer onboarding team";
}

function goalReviewRequired(value: unknown) {
  const policy = objectValue(value);
  return policy?.required === true || policy?.type === "human_final_review";
}

function goalReviewPolicyLabel(value: unknown) {
  return goalReviewRequired(value)
    ? "Human final review required"
    : "No final review required";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
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

function parseProgressMarkdownTasks(
  content?: string | null,
): ThreadInfoChecklistTask[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const tableStart = lines.findIndex((line) =>
    /^\|\s*Task\s*\|\s*Status\s*\|\s*Owner\s*\|\s*Required\s*\|\s*Blocker\/Notes\s*\|/i.test(
      line,
    ),
  );
  if (tableStart < 0) return [];

  const subject = extractProgressSubject(lines);
  const tasks: ThreadInfoChecklistTask[] = [];
  for (const line of lines.slice(tableStart + 2)) {
    if (!line.trim().startsWith("|")) break;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 5) continue;
    const [title, status, owner, required, notes] = cells;
    if (!title || /^---+$/.test(title)) continue;
    tasks.push({
      id: `progress:${tasks.length}:${title}`,
      title: displayProgressTaskTitle(title, subject),
      status,
      assigneeDisplay: owner || null,
      required: !/^no$/i.test(required),
      blocked:
        status.toLowerCase() === "blocked" ||
        /\bblocked|waiting on|hold\b/i.test(notes),
      notes: notes || null,
    });
  }
  return tasks;
}

function extractProgressSubject(lines: string[]): string | null {
  for (const line of lines) {
    const goalMatch = line.match(
      /^Goal:\s*Complete customer onboarding for\s+(.+?)\.?\s*$/i,
    );
    if (goalMatch?.[1]) return goalMatch[1].trim();

    const threadMatch = line.match(/^Thread:\s*(.+?)\s+onboarding\s*$/i);
    if (threadMatch?.[1]) return threadMatch[1].trim();
  }
  return null;
}

function displayProgressTaskTitle(
  title: string,
  subject: string | null,
): string {
  const trimmed = title.trim();
  if (!subject) return trimmed;
  const suffix = ` - ${subject}`;
  return trimmed.endsWith(suffix)
    ? trimmed.slice(0, -suffix.length).trim()
    : trimmed;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) =>
    cell
      .replace(/\\\|/g, "|")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
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
  options: { expectAssistantResponse?: boolean } = {},
): TaskThread | null {
  if (!thread) return null;
  const alreadyPersisted = thread.messages.some(
    (message) =>
      message.role.toUpperCase() === "USER" &&
      message.content?.trim() === content.trim(),
  );
  const hasOptimisticTurn = (thread.turns ?? []).some(
    (turn) => turn.id === "optimistic-computer-turn",
  );

  const turns =
    options.expectAssistantResponse === false || hasOptimisticTurn
      ? (thread.turns ?? [])
      : [
          {
            id: "optimistic-computer-turn",
            status: "running",
            invocationSource: "chat_message",
            startedAt: new Date().toISOString(),
          },
          ...(thread.turns ?? []),
        ];

  return {
    ...thread,
    messages: alreadyPersisted
      ? thread.messages
      : [
          ...thread.messages,
          {
            id: "optimistic-user-message",
            role: "USER",
            content,
          },
        ],
    turns,
  };
}

function toTaskThread(thread: NonNullable<ThreadResult["thread"]>): TaskThread {
  return {
    id: thread.id,
    identifier: thread.identifier,
    title: thread.title,
    status: thread.status,
    lifecycleStatus: thread.lifecycleStatus,
    costSummary: thread.costSummary,
    messages: (thread.messages?.edges ?? []).map(({ node }) => ({
      id: node.id,
      role: node.role,
      content: node.content,
      sender: node.sender,
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

function toOptimisticTaskThread(start: PendingThreadStart): TaskThread {
  return {
    id: start.threadId,
    title: start.title,
    status: "in_progress",
    lifecycleStatus: null,
    costSummary: null,
    messages: [],
    turns: [],
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

function toTaskThreadTurnsFromRows(rows: ThreadTurnRow[]): TaskThreadTurn[] {
  return rows
    .filter((row) => !isHiddenDesktopDelegationRow(row))
    .map((row) => ({
      id: row.id,
      status: row.status,
      invocationSource: row.invocation_source ?? "chat_message",
      runtimeType: row.runtime_type ?? null,
      startedAt: row.started_at ?? row.created_at,
      finishedAt: row.finished_at,
      model: stringValue(
        metadataObject(row.context_snapshot)?.model ??
          metadataObject(row.result_json)?.model,
      ),
      usageJson: row.usage_json,
      resultJson: row.result_json,
      error: row.error ?? null,
      errorCode: row.error_code ?? null,
      systemPrompt: row.system_prompt ?? null,
      events: [],
    }));
}

function isHiddenDesktopDelegationRow(row: ThreadTurnRow): boolean {
  const snapshot = metadataObject(row.context_snapshot);
  const delegation = metadataObject(snapshot?.desktop_managed_delegation);
  return delegation?.visibility === "hidden";
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

function isCustomerOnboardingChatUpdateHandled(metadata: unknown): boolean {
  const record = metadataObject(metadata);
  const update = metadataObject(record?.customerOnboardingChatUpdate);
  return update?.handled === true && update.agentDispatchRequired !== true;
}

function threadTitleFallbackFromState(state: unknown, threadId: string) {
  if (!state || typeof state !== "object") return null;
  const fallback = (state as { threadTitleFallback?: unknown })
    .threadTitleFallback;
  if (!fallback || typeof fallback !== "object") return null;
  const record = fallback as { threadId?: unknown; title?: unknown };
  if (record.threadId !== threadId) return null;
  return stringValue(record.title);
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
