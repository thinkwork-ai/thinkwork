import { useCallback } from "react";
import { useMutation, useQuery } from "urql";
import {
  CreateThreadMutation,
  ThreadQuery,
  UpdateThreadMutation,
} from "../graphql/queries";
import type { CreateThreadInput, Thread, UpdateThreadInput } from "../types";

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

// Returns an imperative `(threadId, input) => Promise<Thread>`. Unbound from
// any specific threadId so callers can update threads that were just created,
// marked-read inline, archived, etc. without the hook-then-rerender dance.
export function useUpdateThread() {
  const [, updateThread] = useMutation<{ updateThread: Thread }>(UpdateThreadMutation);
  return useCallback(
    async (threadId: string, input: UpdateThreadInput): Promise<Thread> => {
      if (!threadId) throw new Error("useUpdateThread: threadId is required");
      const result = await updateThread({ id: threadId, input });
      const thread = result.data?.updateThread;
      if (!thread) {
        throw result.error ?? new Error("Failed to update thread");
      }
      return thread;
    },
    [updateThread],
  );
}
