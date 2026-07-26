import { useMemo, useRef } from "react";
import { useSubscription } from "urql";
import { graphql } from "../gql";
import { useTenant } from "../context/TenantContext";

const THREAD_ACTIVITY_SUBSCRIPTION = graphql(`
  subscription SpacesThreadActivity($userId: ID!) {
    onThreadActivity(userId: $userId) {
      userId
      tenantId
      threadId
      messageId
      authorId
      authorType
      snippet
      threadTitle
      mentioned
      shouldNotify
      createdAt
    }
  }
`);

export interface ThreadActivityLike {
  threadId: string;
  authorId?: string | null;
  snippet?: string | null;
  threadTitle?: string | null;
  /** Server-computed: this event directly @mentions the recipient (R10/R11). */
  mentioned?: boolean | null;
  /** Server-computed per-user notification decision (KTD5/R10). */
  shouldNotify?: boolean | null;
}

export interface UseThreadNotificationsOptions {
  /**
   * Fired for EVERY received activity event — mentioned or not, muted or not.
   * The shell wires this to its coalesced thread-list refetch so a freshly-
   * mentioned user's sidebar shows the thread + unread state without a reload
   * (R9).
   */
  onActivity?: (activity: ThreadActivityLike) => void;
}

/**
 * Shell-mounted hook: subscribes to the current user's onThreadActivity stream
 * and drives sidebar liveness (R9) through `onActivity`.
 */
export function useThreadNotifications(
  options: UseThreadNotificationsOptions = {},
): void {
  const { onActivity } = options;
  const { userId } = useTenant();

  // Keep the latest onActivity without re-memoizing the subscription handler.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const handler = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_prev: any, event: any) => {
      const activity = event?.onThreadActivity as
        | ThreadActivityLike
        | undefined;
      if (!activity || !activity.threadId) return event;

      // R9 sidebar liveness: every event (mentioned or not, muted or not)
      // drives the shell's coalesced list refetch.
      onActivityRef.current?.(activity);
      return event;
    };
  }, []);

  useSubscription(
    {
      query: THREAD_ACTIVITY_SUBSCRIPTION,
      variables: { userId: userId ?? "" },
      pause: !userId,
    },
    handler,
  );
}
