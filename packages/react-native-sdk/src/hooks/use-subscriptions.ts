import { useMemo } from "react";
import { useSubscription } from "urql";
import { gql } from "urql";
import { useThinkworkAuth } from "../auth/provider";

const NewMessageSubscription = gql`
  subscription OnNewMessage($threadId: ID!) {
    onNewMessage(threadId: $threadId) {
      messageId
      threadId
      tenantId
      role
      content
      senderType
      senderId
      createdAt
    }
  }
`;

const ThreadTurnUpdatedSubscription = gql`
  subscription OnThreadTurnUpdated($tenantId: ID!) {
    onThreadTurnUpdated(tenantId: $tenantId) {
      runId
      triggerId
      tenantId
      threadId
      agentId
      status
      triggerName
      updatedAt
    }
  }
`;

const ThreadUpdatedSubscription = gql`
  subscription OnThreadUpdated($tenantId: ID!) {
    onThreadUpdated(tenantId: $tenantId) {
      threadId
      tenantId
      status
      title
      updatedAt
    }
  }
`;

export interface NewMessageEvent {
  messageId: string;
  threadId: string;
  tenantId: string;
  role: string;
  content: string | null;
  senderType: string | null;
  senderId: string | null;
  createdAt: string;
}

export interface ThreadTurnUpdateEvent {
  runId: string;
  triggerId: string | null;
  tenantId: string;
  threadId: string | null;
  agentId: string | null;
  status: string;
  triggerName: string | null;
  updatedAt: string;
}

export interface ThreadUpdateEvent {
  threadId: string;
  tenantId: string;
  status: string;
  title: string;
  updatedAt: string;
}

export function useNewMessageSubscription(threadId: string | null | undefined) {
  return useSubscription<{ onNewMessage: NewMessageEvent }>({
    query: NewMessageSubscription,
    variables: { threadId },
    pause: !threadId,
  });
}

/**
 * Subscribes to agent turn updates for a specific thread. The underlying
 * AppSync subscription is tenant-scoped; this hook reads `tenantId` from the
 * authenticated user and filters server-emitted events client-side.
 */
export function useThreadTurnSubscription(threadId: string | null | undefined) {
  const { user } = useThinkworkAuth();
  const tenantId = user?.tenantId ?? null;
  const [{ data, error, fetching }] = useSubscription<{
    onThreadTurnUpdated: ThreadTurnUpdateEvent;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId || !threadId,
  });

  const filtered = useMemo(() => {
    if (!data || !threadId) return undefined;
    return data.onThreadTurnUpdated.threadId === threadId ? data : undefined;
  }, [data, threadId]);

  return [{ data: filtered, error, fetching }] as const;
}

/**
 * Tenant-wide agent turn subscription — no client-side thread filter.
 * Use this when the consumer wants to react to turn updates across every
 * thread in the tenant (e.g. dashboards, per-tenant activity feeds).
 * For a thread-scoped stream, see `useThreadTurnSubscription`.
 */
export function useThreadTurnUpdatedSubscription(
  tenantId: string | null | undefined,
) {
  return useSubscription<{ onThreadTurnUpdated: ThreadTurnUpdateEvent }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
}

/**
 * Tenant-wide thread-update subscription — fires whenever any thread's
 * status or title changes. Use for dashboards that need to re-query the
 * thread list on any mutation, or badges that reflect cross-thread
 * activity.
 */
export function useThreadUpdatedSubscription(
  tenantId: string | null | undefined,
) {
  return useSubscription<{ onThreadUpdated: ThreadUpdateEvent }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
}
