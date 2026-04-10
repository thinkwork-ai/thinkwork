import { useQuery, useMutation, useSubscription } from "urql";
import {
  MessagesQuery,
  SendMessageMutation,
  DeleteMessageMutation,
  OnNewMessageSubscription,
} from "@/lib/graphql-queries";

export function useMessages(threadId: string | undefined, opts?: { limit?: number; cursor?: string }) {
  return useQuery({
    query: MessagesQuery,
    variables: { threadId: threadId!, ...opts },
    pause: !threadId,
  });
}

export function useSendMessage() {
  return useMutation(SendMessageMutation);
}

export function useDeleteMessage() {
  return useMutation(DeleteMessageMutation);
}

export function useNewMessageSubscription(threadId: string | undefined) {
  return useSubscription({
    query: OnNewMessageSubscription,
    variables: { threadId: threadId! },
    pause: !threadId,
  });
}
