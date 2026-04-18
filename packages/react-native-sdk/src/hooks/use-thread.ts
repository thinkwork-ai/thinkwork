import { useCallback } from "react";
import { useMutation, useQuery } from "urql";
import { CreateThreadMutation, ThreadQuery } from "../graphql/queries";
import type { CreateThreadInput, Thread } from "../types";

export function useThread(threadId: string | null | undefined) {
  const [{ data, fetching, error }, refetch] = useQuery<{ thread: Thread }>({
    query: ThreadQuery,
    variables: { id: threadId },
    pause: !threadId,
    requestPolicy: "cache-and-network",
  });

  return {
    thread: data?.thread ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

export function useCreateThread() {
  const [, createThread] = useMutation<{ createThread: Thread }>(CreateThreadMutation);
  return useCallback(
    async (input: CreateThreadInput): Promise<Thread> => {
      const result = await createThread({ input });
      const thread = result.data?.createThread;
      if (!thread) {
        throw result.error ?? new Error("Failed to create thread");
      }
      return thread;
    },
    [createThread],
  );
}
