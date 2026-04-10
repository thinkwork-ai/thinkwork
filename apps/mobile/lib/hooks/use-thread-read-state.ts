import { useCallback } from "react";
import { useMutation } from "urql";
import { UpdateThreadMutation } from "@/lib/graphql-queries";

export function useThreadReadState() {
  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);

  const markRead = useCallback((threadId: string) => {
    executeUpdateThread({
      id: threadId,
      input: { lastReadAt: new Date().toISOString() } as any,
    }).catch(() => {});
  }, [executeUpdateThread]);

  const isUnread = useCallback(
    (threadId: string, lastTurnCompletedAt: string, lastReadAt?: string | null) => {
      if (!lastTurnCompletedAt) return false;
      if (!lastReadAt) return true;
      return new Date(lastTurnCompletedAt).getTime() > new Date(lastReadAt).getTime();
    },
    [],
  );

  return { markRead, isUnread };
}
