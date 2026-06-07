---
title: "apps/web urql document cache doesn't auto-invalidate on live events — tagged threads need an explicit refetch"
module: apps/web
date: 2026-05-29
problem_type: integration_issue
component: spaces_chat
severity: medium
symptoms:
  - "A thread you were @mentioned into does not appear in the sidebar thread list until the list query re-runs"
  - "On desktop the tagged thread did not appear even after a manual refresh, while web showed it after refresh"
  - "AppSync subscription events fire but the sidebar list stays stale"
root_cause: cache_invalidation
resolution_type: code_fix
related_components:
  - appsync_subscriptions
  - chat_sidebar
tags:
  - urql
  - appsync
  - cache-invalidation
  - subscriptions
  - spaces
  - desktop
  - multiplayer
---

# apps/web urql document cache doesn't auto-invalidate on live events

## Problem

A user @mentioned into a new thread did not see it appear in their `apps/web` sidebar. On the desktop (Electron) app it never showed — even after a manual refresh; on web it appeared only after a full page reload.

## Symptoms

- Mention-created participant threads are missing from the sidebar list until the list query re-executes.
- Live AppSync events arrive but the thread list doesn't update.
- Desktop and web diverge: web recovers on hard reload, desktop appeared not to.

## What Didn't Work

- Assuming it was a backend list-scoping bug. The recent-threads resolver (`packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts`) already includes participant threads via `callerVisibleThreadPredicate`, so the thread was query-eligible. (A _separate_ private-Space visibility bug also existed — see `docs/solutions/logic-errors/thread-visibility-private-space-mention.md` — but it was not the cause of the no-refresh symptom.)
- Expecting the existing AppSync subscription to update the list. It doesn't, because of the cache mechanics below.

## Why This Works (root cause)

`apps/web` configures urql with the **document `cacheExchange`, not `graphcache`** (`apps/web/src/lib/graphql-client.ts`). The document cache only updates a query's result when a mutation returns overlapping `__typename`+`id` data or the query is explicitly re-executed. A subscription event arriving on a _different_ document (e.g. `onThreadUpdated`) does **not** invalidate the `ThreadsPagedQuery` result. There is no normalized cache to patch, so nothing refreshes the sidebar on its own. `requestPolicy: "cache-and-network"` only refetches on mount/navigation — not on a live event.

The hand-rolled `AppSyncSubscriptionClient` also has no event replay: events that land while the socket is down (window backgrounded/asleep on desktop) are lost permanently, which is the most likely explanation for the desktop "even after refresh" divergence.

## Solution

Drive an explicit refetch of the list queries on the two signals that matter, coalesced so a burst triggers at most one network call (`apps/web/src/components/shell/ChatSidebar.tsx`):

1. **Window focus / visibility** — refetch on the focus/visible transition so returning to a backgrounded desktop window surfaces anything missed while the socket was down.
2. **`onThreadUpdated` subscription** — reuse the existing **tenant-scoped** subscription (it fires for the caller on both `createThread` and `sendMessage`, with no participant filter), and on each event call the existing `reexecuteRecentThreadsQuery({ requestPolicy: "network-only" })`.

Key point: **no new subscription field was needed.** `onThreadUpdated(tenantId)` already reaches a newly-mentioned user because it's tenant-wide, so reusing it avoided an AppSync schema change + codegen.

```ts
// debounced/coalesced refetch shared by both signals
const refreshThreadLists = useCallback(
  () => {
    reexecuteRecentThreadsQuery({ requestPolicy: "network-only" });
    reexecutePinnedThreadsQuery({ requestPolicy: "network-only" });
    reexecuteSearchThreadsQuery({ requestPolicy: "network-only" });
  },
  [
    /* the three reexecute handles */
  ],
);

// 1) window focus/visibility transition  2) onThreadUpdated event  -> scheduleThreadListRefresh()
```

Ordering caveat: in `createThread`, `notifyThreadUpdate` fires _before_ the mention-participant row is inserted. Since `onThreadUpdated` isn't participant-filtered the recipient still gets the event, but a single immediate refetch can race the participant-row commit — the focus-refetch (or a second event) is the backstop.

## Prevention

- **Before reaching for "add a subscription" to fix a stale list, check the urql exchange in use.** With the document `cacheExchange`, live events never invalidate sibling queries — you need an explicit `reexecute…({ requestPolicy: "network-only" })`, not more subscriptions.
- **Reuse a tenant-scoped event before adding a new field.** `onThreadUpdated(tenantId)` already fans out to all of a tenant's clients; adding a participant-added field would have cost a `schema:build` + codegen across every consumer for no benefit.
- **Coalesce live refetches.** Tenant-wide events are chatty; debounce so a burst is one network call.

## Related: multiplayer "Working…" turn attribution (same PR, apps/web)

A separate multiplayer rendering bug shipped in the same change: `mapTurnsToUserMessages` (`apps/web/src/components/workbench/TaskThreadView.tsx`) paired the i-th turn to the i-th USER message **by document position**. In a multiplayer thread, other humans' messages are USER messages that trigger no agent turn, so positional pairing pinned the agent's "Working…" row to the wrong (earlier) message. Fix: pair each turn to the **nearest-preceding user message by timestamp** (`turn.startedAt` vs `message.createdAt`), with a positional fallback when message timestamps are absent (older/synthetic threads).

**Residual:** `turn.startedAt` derives from the task's _claim_ time, not the trigger instant, so two messages fired before the first turn is claimed can still mis-attribute. A turn→triggering-message-id link would remove the timestamp inference entirely — the durable fix if this recurs.
