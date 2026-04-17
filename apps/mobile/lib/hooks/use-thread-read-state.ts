import { useCallback, useSyncExternalStore } from "react";
import { useMutation } from "urql";
import { UpdateThreadMutation } from "@/lib/graphql-queries";

// Optimistic read-state tracking.
//
// The server is authoritative (`threads.last_read_at`), but the GraphQL
// `updateThread` mutation only returns `{ id title status priority updatedAt }`
// — no `lastReadAt` — so urql's document cache can't patch the list rows
// in place. Worse, the tasks list query isn't on the 15s poll or the
// thread-updated subscription, so a fresh `lastReadAt` can sit on the
// server for minutes before the dot/badge reflect it.
//
// To keep the UI honest on tap we keep a module-level Set of thread IDs
// the user has *just* read in this session, fan changes out via
// useSyncExternalStore, and short-circuit `isUnread` when the ID is in
// the set. The server mutation still fires; this is just the local
// shadow so the unread pip disappears before the round-trip returns.
const _locallyRead = new Set<string>();
let _version = 0;
const _listeners = new Set<() => void>();
function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}
function _getVersion() {
  return _version;
}
function _markLocal(id: string) {
  if (_locallyRead.has(id)) return;
  _locallyRead.add(id);
  _version += 1;
  for (const l of _listeners) l();
}

/** Detail page's mount effect uses this to skip a redundant server
 *  mutation when the list-row tap has already fired one. */
export function isLocallyRead(threadId: string): boolean {
  return _locallyRead.has(threadId);
}

export function useThreadReadState() {
  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);
  useSyncExternalStore(_subscribe, _getVersion);

  const markRead = useCallback((threadId: string) => {
    _markLocal(threadId);
    executeUpdateThread({
      id: threadId,
      input: { lastReadAt: new Date().toISOString() } as any,
    }).catch(() => {});
  }, [executeUpdateThread]);

  const isUnread = useCallback(
    (threadId: string, lastTurnCompletedAt: string, lastReadAt?: string | null) => {
      if (_locallyRead.has(threadId)) return false;
      if (!lastTurnCompletedAt) return false;
      if (!lastReadAt) return true;
      return new Date(lastTurnCompletedAt).getTime() > new Date(lastReadAt).getTime();
    },
    [],
  );

  return { markRead, isUnread };
}
