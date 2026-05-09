import { useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import {
  TaskThreadView,
  type TaskThread,
} from "@/components/computer/TaskThreadView";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerThreadQuery,
  ComputerThreadTasksQuery,
  NewMessageSubscription,
  SendMessageMutation,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";

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
  const computerId = data?.thread?.computerId ?? null;
  const [{ data: tasksData }, reexecuteTasksQuery] =
    useQuery<ThreadTasksResult>({
      query: ComputerThreadTasksQuery,
      variables: { computerId, threadId, limit: 6 },
      pause: !computerId,
    });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const { chunks, reset: resetStreamingChunks } =
    useComputerThreadChunks(threadId);
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
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteQuery,
    reexecuteTasksQuery,
    threadId,
    turnUpdate?.onThreadTurnUpdated?.threadId,
  ]);

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteQuery,
    reexecuteTasksQuery,
    threadId,
    threadUpdate?.onThreadUpdated?.threadId,
  ]);

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === threadId) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteQuery,
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

  const thread = data?.thread ? toTaskThread(data.thread) : null;
  if (thread) {
    thread.turns = toTaskThreadTurns(tasksData?.computerTasks);
  }
  const visibleThread = optimisticMessage
    ? withOptimisticUserTurn(thread, optimisticMessage)
    : thread;
  const hasDurableAssistant = hasDurableAssistantAfterLatestUser(visibleThread);

  useEffect(() => {
    if (hasDurableAssistant) {
      resetStreamingChunks();
    }
  }, [hasDurableAssistant, resetStreamingChunks]);

  return (
    <TaskThreadView
      thread={visibleThread}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      streamingChunks={hasDurableAssistant ? [] : chunks}
      isSending={sending}
      onSendFollowUp={async (content) => {
        setOptimisticMessage(content);
        resetStreamingChunks();
        const result = await sendMessage({
          input: {
            threadId,
            role: "USER",
            content,
          },
        });
        if (result.error) {
          setOptimisticMessage(null);
          throw result.error;
        }
        reexecuteQuery({ requestPolicy: "network-only" });
        reexecuteTasksQuery({ requestPolicy: "network-only" });
      }}
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

function toTaskThreadTurns(tasks: ThreadTasksResult["computerTasks"]) {
  return (tasks ?? []).map((task) => {
    const input = metadataObject(task.input) ?? {};
    const output = metadataObject(task.output) ?? {};
    return {
      id: task.id,
      status: task.status,
      invocationSource: stringValue(input.source) ?? "chat_message",
      startedAt: task.claimedAt ?? task.createdAt,
      finishedAt: task.completedAt,
      usageJson: output.usage,
      resultJson: output,
      error: taskErrorMessage(task.error),
    };
  });
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
