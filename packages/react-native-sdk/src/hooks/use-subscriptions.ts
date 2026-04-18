import { useMemo } from "react";
import { useSubscription } from "urql";
import { gql } from "urql";
import { useThinkworkAuth } from "../auth/provider";

const NewMessageSubscription = gql`
  subscription NewMessage($threadId: ID!) {
    newMessage(threadId: $threadId) {
      messageId
      threadId
      authorId
      role
      kind
      content
      createdAt
    }
  }
`;

const ThreadTurnUpdatedSubscription = gql`
  subscription ThreadTurnUpdated($tenantId: ID!) {
    threadTurnUpdated(tenantId: $tenantId) {
      turnId
      threadId
      status
      updatedAt
    }
  }
`;

export interface NewMessageEvent {
  messageId: string;
  threadId: string;
  authorId: string | null;
  role: string;
  kind: string;
  content: string;
  createdAt: string;
}

export interface ThreadTurnUpdateEvent {
  turnId: string;
  threadId: string;
  status: string;
  updatedAt: string;
}

export function useNewMessageSubscription(threadId: string | null | undefined) {
  return useSubscription<{ newMessage: NewMessageEvent }>({
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
    threadTurnUpdated: ThreadTurnUpdateEvent;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId || !threadId,
  });

  const filtered = useMemo(() => {
    if (!data || !threadId) return undefined;
    return data.threadTurnUpdated.threadId === threadId ? data : undefined;
  }, [data, threadId]);

  return [{ data: filtered, error, fetching }] as const;
}
