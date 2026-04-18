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
