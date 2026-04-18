import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import { MessagesQuery, SendMessageMutation } from "../graphql/queries";
import type { Message } from "../types";
import { useNewMessageSubscription } from "./use-subscriptions";

interface MessageEdge {
  node: Message;
  cursor: string;
}
interface MessageConnection {
  edges: MessageEdge[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export function useMessages(threadId: string | null | undefined) {
  const [{ data, fetching, error }, refetch] = useQuery<{ messages: MessageConnection }>({
    query: MessagesQuery,
    variables: { threadId },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });

  const [sub] = useNewMessageSubscription(threadId);

  useEffect(() => {
    if (sub.data && threadId) refetch({ requestPolicy: "network-only" });
  }, [sub.data, threadId, refetch]);

  const messages = useMemo(
    () => data?.messages?.edges.map((e) => e.node) ?? [],
    [data],
  );

  return {
    messages,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

// Unbound imperative sender. Pre-0.2.0 the hook took a threadId at render time,
// which was a footgun for "create thread then send first message" flows: the
// freshly-minted threadId wasn't available until after the component re-rendered.
// Callers now pass the threadId at call time.
export function useSendMessage() {
  const [, sendMessage] = useMutation<{ sendMessage: Message }>(SendMessageMutation);
  return useCallback(
    async (threadId: string, content: string): Promise<Message> => {
      if (!threadId) throw new Error("useSendMessage: threadId is required");
      const result = await sendMessage({
        input: { threadId, role: "USER", content, senderType: "user" },
      });
      const message = result.data?.sendMessage;
      if (!message) {
        throw result.error ?? new Error("Failed to send message");
      }
      return message;
    },
    [sendMessage],
  );
}
