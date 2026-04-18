import { useQuery } from "urql";
import { MessagesQuery } from "@/lib/graphql-queries";

/**
 * Local messages query — kept (rather than swapped to the SDK's
 * `useMessages`) because the chat-oriented SDK Message shape doesn't
 * expose the ThinkWork-mobile-specific `toolResults` + `durableArtifact`
 * fields that the GenUI chat surface depends on. The rest of the
 * send/update/subscribe path lives in the SDK.
 */
export function useMessages(
  threadId: string | undefined,
  opts?: { limit?: number; cursor?: string },
) {
  return useQuery({
    query: MessagesQuery,
    variables: { threadId: threadId!, ...opts },
    pause: !threadId,
  });
}
