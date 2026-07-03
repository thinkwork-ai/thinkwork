import { useEffect, useMemo, useRef, useState } from "react";
import { useSubscription } from "urql";
import { graphql } from "../gql";
import { useTenant } from "../context/TenantContext";
import { getDesktopBridge } from "../lib/desktop-runtime";

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
  /**
   * Server-computed per-user notification decision (KTD5/R10). Absent/null on
   * legacy events published before the field existed → treated as true for
   * backward compat; only an explicit `false` (muted, not mentioned) suppresses
   * the OS notification. Sidebar liveness (R9) is never gated on this.
   */
  shouldNotify?: boolean | null;
}

export interface NotificationSuppressionState {
  userId: string | null;
  activeThreadId: string | null;
  appFocused: boolean;
  enabled: boolean;
}

/**
 * Pure suppression decision (R3 + R5 + R10 + U7 toggle). Returns true when an OS
 * notification should be raised for this activity event. This is the OS-notify
 * decision only — sidebar liveness (R9) always fires regardless of this result.
 */
export function shouldRaiseNotification(
  activity: ThreadActivityLike,
  state: NotificationSuppressionState,
): boolean {
  if (!state.enabled) return false; // U7 toggle off
  if (!activity.threadId) return false;
  // R10: honor the server-computed per-user preference. Muted-and-not-mentioned
  // events arrive with shouldNotify:false; a direct @mention punches through
  // (server sets shouldNotify:true). Absent/null (legacy events) → notify.
  if (activity.shouldNotify === false) return false;
  // R3: never notify for the current user's own message.
  if (activity.authorId && activity.authorId === state.userId) return false;
  // R5: never notify for the thread being actively viewed (app focused).
  if (state.appFocused && state.activeThreadId === activity.threadId) {
    return false;
  }
  return true;
}

/**
 * Notification body (R11 + R4/R6). A single event shows its snippet; a coalesced
 * burst collapses to a count.
 */
export function buildNotificationBody(input: {
  count: number;
  snippet?: string | null;
}): string {
  if (input.count > 1) return `${input.count} new messages`;
  const snippet = input.snippet?.trim();
  return snippet ? snippet : "New message";
}

// Per-thread coalescing window. Events for one thread inside this window collapse
// into a single raise/replace (R4/R6). Short enough that a lone message still
// notifies promptly.
const COALESCE_WINDOW_MS = 350;

interface CoalesceEntry {
  count: number;
  snippet?: string | null;
  threadTitle?: string | null;
  timer: ReturnType<typeof setTimeout>;
}

export interface UseThreadNotificationsOptions {
  /** U7 global on/off toggle. Defaults to enabled. Gates OS notifications only. */
  enabled?: boolean;
  /**
   * The thread the user is actively viewing (route param), used by the R5
   * focused-thread suppression gate. Null when not on a thread route.
   */
  activeThreadId?: string | null;
  /**
   * Fired for EVERY received activity event — mentioned or not, muted or not,
   * web or desktop, notifications on or off. The shell wires this to its
   * coalesced thread-list refetch so a freshly-mentioned user's sidebar shows
   * the thread + unread state without a reload (R9). Independent of the OS
   * notification decision.
   */
  onActivity?: (activity: ThreadActivityLike) => void;
}

/**
 * Shell-mounted hook: subscribes to the current user's onThreadActivity stream
 * (whenever a userId exists — web AND desktop, for sidebar liveness) and raises
 * native desktop notifications on the desktop build (per-thread coalesced,
 * own-message / focused-thread / muted suppressed). Sidebar liveness is driven
 * via the `onActivity` callback regardless of the desktop bridge.
 */
export function useThreadNotifications(
  options: UseThreadNotificationsOptions = {},
): void {
  const { enabled = true, activeThreadId = null, onActivity } = options;
  const { userId } = useTenant();
  const bridge = useMemo(() => getDesktopBridge(), []);

  // Keep the latest onActivity without re-memoizing the subscription handler.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  // App-focus state pushed from the main process. Defaults to focused (so the
  // web build / pre-event state never over-notifies the viewed thread).
  const [appFocused, setAppFocused] = useState(true);

  const stateRef = useRef<NotificationSuppressionState>({
    userId,
    activeThreadId,
    appFocused,
    enabled,
  });
  stateRef.current = { userId, activeThreadId, appFocused, enabled };

  const coalesceRef = useRef(new Map<string, CoalesceEntry>());

  useEffect(() => {
    if (!bridge) return;
    return bridge.onWindowFocusChange(({ focused }) => setAppFocused(focused));
  }, [bridge]);

  // Flush all pending timers on unmount.
  useEffect(() => {
    const pending = coalesceRef.current;
    return () => {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    };
  }, []);

  const handler = useMemo(() => {
    const scheduleFlush = (
      threadId: string,
    ): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        const map = coalesceRef.current;
        const entry = map.get(threadId);
        if (!entry) return;
        map.delete(threadId);
        void bridge?.raiseThreadNotification({
          threadId,
          title: entry.threadTitle?.trim() || "New message",
          body: buildNotificationBody({
            count: entry.count,
            snippet: entry.snippet,
          }),
          count: entry.count,
        });
      }, COALESCE_WINDOW_MS);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_prev: any, event: any) => {
      const activity = event?.onThreadActivity as ThreadActivityLike | undefined;
      if (!activity || !activity.threadId) return event;

      // R9 sidebar liveness: every event (mentioned or not, muted or not, web or
      // desktop, notifications on or off) drives the shell's coalesced list
      // refetch. Independent of, and always ahead of, the OS-notify decision.
      onActivityRef.current?.(activity);

      // Native OS notification path — desktop only, gated on the server's
      // per-user shouldNotify decision plus own/focused-thread suppression.
      if (!bridge) return event;
      if (!shouldRaiseNotification(activity, stateRef.current)) return event;

      const map = coalesceRef.current;
      const existing = map.get(activity.threadId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.count += 1;
        existing.snippet = activity.snippet;
        existing.threadTitle = activity.threadTitle;
        existing.timer = scheduleFlush(activity.threadId);
        map.set(activity.threadId, existing);
      } else {
        map.set(activity.threadId, {
          count: 1,
          snippet: activity.snippet,
          threadTitle: activity.threadTitle,
          timer: scheduleFlush(activity.threadId),
        });
      }
      return event;
    };
  }, [bridge]);

  useSubscription(
    {
      query: THREAD_ACTIVITY_SUBSCRIPTION,
      variables: { userId: userId ?? "" },
      // Subscribe whenever a userId exists — web AND desktop. The web build has
      // no bridge (no OS notification) but still needs the event for sidebar
      // liveness (R9), and liveness must not depend on the OS-notify toggle.
      pause: !userId,
    },
    handler,
  );
}
