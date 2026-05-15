import { useEffect, useMemo, useState } from "react";
import { useClient, useMutation, useQuery, useSubscription } from "urql";
import {
  TaskThreadView,
  normalizePersistedParts,
  type TaskThread,
} from "@/components/computer/TaskThreadView";
import { ThreadDetailActions } from "@/components/computer/ThreadDetailActions";
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
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";
import { createAppSyncChatTransport } from "@/lib/use-chat-appsync-transport";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";

interface ComputerThreadDetailRouteProps {
  threadId: string;
}

interface ThreadResult {
  thread: {
    id: string;
    computerId?: string | null;
    title?: string | null;
    status?: string | null;
    lifecycleStatus?: string | null;
    costSummary?: number | null;
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

export function ComputerThreadDetailRoute({
  threadId,
}: ComputerThreadDetailRouteProps) {
  const { tenantId } = useTenant();
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id: threadId, messageLimit: 100 },
  });
  const threadTitle = data?.thread?.title?.trim() || "Thread";

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

  usePageHeaderActions({
    backHref: "/threads",
    title: threadTitle,
    // Tab title gets the "Thread · " prefix to match the section pattern
    // used by Memory and other pages ("Memory · ThinkWork", etc.). The
    // in-page header keeps the bare thread title — no need to repeat
    // "Thread" inside the page the user is already on.
    documentTitle: `Thread · ${threadTitle}`,
    action: (
      <ThreadDetailActions
        threadId={threadId}
        threadTitle={threadTitle}
        attachedArtifacts={attachedArtifacts}
      />
    ),
    actionKey: `thread-actions:${threadId}:${attachedArtifacts.length}`,
  });
  const computerId = data?.thread?.computerId ?? null;
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
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
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
    }
  }, [
    reexecuteEventsQuery,
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
    }
  }, [
    reexecuteEventsQuery,
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
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteEventsQuery,
    reexecuteQuery,
    reexecuteRunbookRunsQuery,
    reexecuteTasksQuery,
    threadId,
  ]);

  useEffect(() => {
    if (
      optimisticMessage &&
      hasPersistedUserMessage(data?.thread?.messages?.edges, optimisticMessage)
    ) {
      setOptimisticMessage(null);
    }
  }, [data?.thread?.messages?.edges, optimisticMessage]);

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

  const thread = data?.thread ? toTaskThread(data.thread) : null;
  if (thread) {
    thread.turns = toTaskThreadTurns(
      tasksData?.computerTasks,
      eventsData?.computerEvents,
    );
  }
  const visibleThread = optimisticMessage
    ? withOptimisticUserTurn(thread, optimisticMessage)
    : thread;
  const runbookQueues = useMemo(
    () => toRunbookQueues(runbookRunsData?.runbookRuns),
    [runbookRunsData?.runbookRuns],
  );
  const hasActiveRunbookQueue = runbookQueues.some((queue) =>
    isActiveRunbookQueue(queue.status),
  );
  const hasDurableAssistant = hasDurableAssistantAfterLatestUser(visibleThread);

  useEffect(() => {
    if (hasDurableAssistant) {
      resetStreamingChunks();
    }
  }, [hasDurableAssistant, resetStreamingChunks]);

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

  return (
    <TaskThreadView
      thread={visibleThread}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      streamingChunks={hasDurableAssistant ? [] : chunks}
      streamState={hasDurableAssistant ? undefined : streamState}
      isSending={sending}
      onSendFollowUp={async (content, files) => {
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
        } = {
          threadId,
          role: "USER",
          content,
        };
        if (attachmentRefs.length > 0) {
          sendInput.metadata = JSON.stringify({ attachments: attachmentRefs });
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
      }}
      runbookQueues={runbookQueues}
    />
  );
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
