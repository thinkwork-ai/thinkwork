import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "urql";
import { MessagesQuery, SendMessageMutation } from "../graphql/queries";
import type { Message } from "../types";
import { useNewMessageSubscription } from "./use-subscriptions";

export function useMessages(threadId: string | null | undefined) {
  const [{ data, fetching, error }, refetch] = useQuery<{ messages: Message[] }>({
    query: MessagesQuery,
    variables: { threadId },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });

  const [sub] = useNewMessageSubscription(threadId);

  useEffect(() => {
    if (sub.data && threadId) refetch({ requestPolicy: "network-only" });
  }, [sub.data, threadId, refetch]);

  const messages = useMemo(() => data?.messages ?? [], [data]);

  return {
    messages,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

export function useSendMessage(threadId: string | null | undefined) {
  const [, sendMessage] = useMutation<{ sendMessage: Message }>(SendMessageMutation);
  return useCallback(
    async (content: string): Promise<Message> => {
      if (!threadId) throw new Error("useSendMessage: threadId is required");
      const result = await sendMessage({
        input: { threadId, content, kind: "text" },
      });
      const message = result.data?.sendMessage;
      if (!message) {
        throw result.error ?? new Error("Failed to send message");
      }
      return message;
    },
    [sendMessage, threadId],
  );
}
