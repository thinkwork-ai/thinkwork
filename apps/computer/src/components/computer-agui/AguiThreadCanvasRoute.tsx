import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import type { AguiChunkInput, AguiComputerEventInput } from "@/agui/events";
import {
  buildLastMileRiskCanvasSmokeChunk,
  isLastMileAguiSmokeEnabled,
} from "@/agui/lastmile-risk-smoke";
import { useAguiThreadStream } from "@/agui/use-agui-thread-stream";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerEventsQuery,
  ComputerThreadChunkSubscription,
  ComputerThreadQuery,
  ComputerThreadTasksQuery,
  NewMessageSubscription,
  SendMessageMutation,
  ThreadUpdatedSubscription,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { AguiCanvas } from "./AguiCanvas";
import { AguiDiagnosticsPanel } from "./AguiDiagnosticsPanel";
import { AguiTranscript, type AguiThreadMessage } from "./AguiTranscript";

interface AguiThreadCanvasRouteProps {
  threadId: string;
}

interface ThreadResult {
  thread: {
    id: string;
    computerId?: string | null;
    title?: string | null;
    messages?: {
      edges?: Array<{
        node: {
          id: string;
          role: string;
          content?: string | null;
          createdAt?: string | null;
        };
      }>;
    } | null;
  } | null;
}

interface ThreadTasksResult {
  computerTasks?: Array<{
    id: string;
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
  computerEvents?: AguiComputerEventInput[] | null;
}

interface ChunkSubscriptionResult {
  onComputerThreadChunk?: {
    threadId: string;
    chunk?: unknown;
    seq?: number | null;
    publishedAt?: string | null;
  } | null;
}

export function AguiThreadCanvasRoute({
  threadId,
}: AguiThreadCanvasRouteProps) {
  const { tenantId } = useTenant();
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );
  const [{ data, fetching, error }, reexecuteThreadQuery] =
    useQuery<ThreadResult>({
      query: ComputerThreadQuery,
      variables: { id: threadId, messageLimit: 100 },
    });
  const threadTitle = data?.thread?.title?.trim() || "Thread";
  usePageHeaderActions({
    backHref: `/threads/${threadId}`,
    title: `${threadTitle} · AG-UI`,
    documentTitle: `AG-UI · ${threadTitle}`,
  });

  const computerId = data?.thread?.computerId ?? null;
  const [{ data: tasksData }, reexecuteTasksQuery] =
    useQuery<ThreadTasksResult>({
      query: ComputerThreadTasksQuery,
      variables: { computerId, threadId, limit: 8 },
      pause: !computerId,
    });
  const [{ data: eventsData }, reexecuteEventsQuery] =
    useQuery<ThreadEventsResult>({
      query: ComputerEventsQuery,
      variables: { computerId, limit: 120 },
      pause: !computerId,
    });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const { chunks, reset: resetChunks } = useAguiRouteChunks(threadId);
  const smokeChunks = useMemo(
    () =>
      isLastMileAguiSmokeEnabled() ? [buildLastMileRiskCanvasSmokeChunk()] : [],
    [],
  );
  const computerEvents = useMemo(
    () =>
      filterThreadEvents(
        tasksData?.computerTasks ?? [],
        eventsData?.computerEvents ?? [],
        threadId,
      ),
    [eventsData?.computerEvents, tasksData?.computerTasks, threadId],
  );
  const { events, diagnostics } = useAguiThreadStream({
    threadId,
    chunks: [...chunks, ...smokeChunks],
    computerEvents,
  });

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
      reexecuteThreadQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteTasksQuery,
    reexecuteThreadQuery,
    threadId,
    turnUpdate?.onThreadTurnUpdated?.threadId,
  ]);

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.threadId === threadId) {
      reexecuteThreadQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }
  }, [
    reexecuteEventsQuery,
    reexecuteTasksQuery,
    reexecuteThreadQuery,
    threadId,
    threadUpdate?.onThreadUpdated?.threadId,
  ]);

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === threadId) {
      reexecuteThreadQuery({ requestPolicy: "network-only" });
      reexecuteTasksQuery({ requestPolicy: "network-only" });
      reexecuteEventsQuery({ requestPolicy: "network-only" });
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteEventsQuery,
    reexecuteTasksQuery,
    reexecuteThreadQuery,
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

  if (fetching && !data) {
    return <AguiRouteState label="Loading thread" />;
  }
  if (error || !data?.thread) {
    return <AguiRouteState label={error?.message ?? "Thread not found"} />;
  }

  const messages = optimisticMessage
    ? [
        ...toThreadMessages(data.thread),
        {
          id: "optimistic-agui-user-message",
          role: "USER",
          content: optimisticMessage,
        },
      ]
    : toThreadMessages(data.thread);

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <AguiTranscript
          messages={messages}
          events={events}
          isSending={sending}
          onSendFollowUp={async (content) => {
            setOptimisticMessage(content);
            resetChunks();
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
            reexecuteThreadQuery({ requestPolicy: "network-only" });
            reexecuteTasksQuery({ requestPolicy: "network-only" });
            reexecuteEventsQuery({ requestPolicy: "network-only" });
          }}
        />
        <AguiCanvas events={events} />
      </div>
      <AguiDiagnosticsPanel diagnostics={diagnostics} />
    </main>
  );
}

function useAguiRouteChunks(threadId: string | null | undefined) {
  const [chunks, setChunks] = useState<AguiChunkInput[]>([]);
  const [{ data }] = useSubscription<ChunkSubscriptionResult>({
    query: ComputerThreadChunkSubscription,
    variables: { threadId },
    pause: !threadId,
  });

  useEffect(() => {
    setChunks([]);
  }, [threadId]);

  useEffect(() => {
    const event = data?.onComputerThreadChunk;
    if (
      !event ||
      event.threadId !== threadId ||
      typeof event.seq !== "number"
    ) {
      return;
    }
    const seq = event.seq;
    setChunks((current) =>
      mergeAguiChunk(current, {
        seq,
        chunk: event.chunk,
        publishedAt: event.publishedAt ?? null,
      }),
    );
  }, [data?.onComputerThreadChunk, threadId]);

  return useMemo(
    () => ({
      chunks,
      reset: () => setChunks([]),
    }),
    [chunks],
  );
}

function mergeAguiChunk(current: AguiChunkInput[], next: AguiChunkInput) {
  const highestSeq = current.reduce(
    (max, chunk) => Math.max(max, chunk.seq),
    0,
  );
  if (highestSeq > 0 && next.seq < highestSeq - 2) return current;
  return [...current.filter((chunk) => chunk.seq !== next.seq), next].sort(
    (a, b) => a.seq - b.seq,
  );
}

function toThreadMessages(
  thread: NonNullable<ThreadResult["thread"]>,
): AguiThreadMessage[] {
  return (thread.messages?.edges ?? []).map(({ node }) => ({
    id: node.id,
    role: node.role,
    content: node.content,
    createdAt: node.createdAt,
  }));
}

function filterThreadEvents(
  tasks: NonNullable<ThreadTasksResult["computerTasks"]>,
  events: AguiComputerEventInput[],
  threadId: string,
) {
  const taskIds = new Set(tasks.map((task) => task.id));
  return events.filter((event) => {
    if (event.taskId && taskIds.has(event.taskId)) return true;
    const payload = recordValue(event.payload);
    return payload?.threadId === threadId || payload?.thread_id === threadId;
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
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

function AguiRouteState({ label }: { label: string }) {
  return (
    <main className="flex h-full items-center justify-center bg-background p-6">
      <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
        {label}
      </div>
    </main>
  );
}
