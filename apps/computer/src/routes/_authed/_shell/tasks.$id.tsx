import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import {
  TaskThreadView,
  type TaskThread,
} from "@/components/computer/TaskThreadView";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerThreadQuery,
  ComputerThreadTurnsQuery,
  NewMessageSubscription,
  SendMessageMutation,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { useComputerThreadChunks } from "@/lib/use-computer-thread-chunks";

export const Route = createFileRoute("/_authed/_shell/tasks/$id")({
  component: TaskDetailPage,
});

interface ThreadResult {
  thread: {
    id: string;
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

interface ThreadTurnsResult {
  threadTurns?: Array<{
    id: string;
    status?: string | null;
    invocationSource?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    usageJson?: unknown;
    resultJson?: unknown;
    error?: string | null;
  }> | null;
}

function TaskDetailPage() {
  const { id } = Route.useParams();
  const { tenantId } = useTenant();
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id, messageLimit: 100 },
  });
  const [{ data: turnsData }, reexecuteTurnsQuery] =
    useQuery<ThreadTurnsResult>({
      query: ComputerThreadTurnsQuery,
      variables: { tenantId, threadId: id, limit: 6 },
      pause: !tenantId,
    });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const chunks = useComputerThreadChunks(id);
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
    variables: { threadId: id },
    pause: !id,
  });

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.threadId === id) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    id,
    reexecuteQuery,
    reexecuteTurnsQuery,
    turnUpdate?.onThreadTurnUpdated?.threadId,
  ]);

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.threadId === id) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    id,
    reexecuteQuery,
    reexecuteTurnsQuery,
    threadUpdate?.onThreadUpdated?.threadId,
  ]);

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === id) {
      reexecuteQuery({ requestPolicy: "network-only" });
      reexecuteTurnsQuery({ requestPolicy: "network-only" });
    }
  }, [
    id,
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteQuery,
    reexecuteTurnsQuery,
  ]);

  const thread = data?.thread ? toTaskThread(data.thread) : null;
  if (thread) {
    thread.turns = toTaskThreadTurns(turnsData?.threadTurns);
  }

  return (
    <TaskThreadView
      thread={thread}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      streamingChunks={hasDurableAssistantAfterLatestUser(thread) ? [] : chunks}
      isSending={sending}
      onSendFollowUp={async (content) => {
        const result = await sendMessage({
          input: {
            threadId: id,
            role: "USER",
            content,
          },
        });
        if (result.error) throw result.error;
        reexecuteQuery({ requestPolicy: "network-only" });
      }}
    />
  );
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

function toTaskThreadTurns(turns: ThreadTurnsResult["threadTurns"]) {
  return (turns ?? []).map((turn) => ({
    id: turn.id,
    status: turn.status,
    invocationSource: turn.invocationSource,
    startedAt: turn.startedAt,
    finishedAt: turn.finishedAt,
    usageJson: turn.usageJson,
    resultJson: turn.resultJson,
    error: turn.error,
  }));
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
