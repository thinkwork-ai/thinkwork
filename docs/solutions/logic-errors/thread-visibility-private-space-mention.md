---
title: "Mention into a private-Space thread was hidden — visibility predicate AND-ed space membership onto participant access"
module: packages/api/src/graphql/resolvers/threads
date: 2026-05-29
problem_type: logic_error
component: thread_visibility
severity: high
symptoms:
  - "A user @mentioned into a thread inside a private Space they don't belong to could not see the thread"
  - "The thread was a valid participant thread but never appeared in the caller's list or thread queries"
  - "Adding a client-side refetch did not surface it — the resolver itself filtered it out"
root_cause: missing_permission
resolution_type: code_fix
related_components:
  - thread_participants
  - spaces
  - space_members
tags:
  - authorization
  - thread-visibility
  - mentions
  - spaces
  - access-control
  - drizzle
---

# Mention into a private-Space thread was hidden by the visibility predicate

## Problem

`callerVisibleThreadPredicate` (`packages/api/src/graphql/resolvers/threads/access.ts`) is the shared SQL predicate gating which threads a user can read (list, detail, goal, progress, etc.). A user mentioned into a thread that lives inside a **private Space they are not a member of** could not see that thread, even though being mentioned is supposed to grant access — the predicate's own docstring says threads are _"private to the requester unless the requester was explicitly added as a participant via a mention."_

## Symptoms

- A mention-created participant thread inside a private Space is absent from the mentioned user's queries.
- No client fix helps — a sidebar refetch can't surface what the resolver excludes.

## Why This Works (root cause)

The predicate was structured as:

```
(caller is author OR caller is an explicit thread_participant)
AND
(thread has no space OR space is public OR caller is a space_member)
```

A mention inserts a `thread_participants` row (`packages/api/src/lib/mentions/thread-participant-mentions.ts`), so the caller satisfies clause 1. But for a private Space they're not in, clause 2 fails — and the `AND` hides the thread. The space-membership clause was silently overriding the participant grant.

## Solution

A mention is a **thread-level invite**, not Space access. Let an explicit participant bypass the space-membership gate **for that one thread** — they still can't see the rest of the private Space (clause 1 still requires author-or-participant per thread). Add a participant-exists escape to the space clause:

```sql
AND (
  threads.space_id IS NULL
  OR <space is public OR caller is a space_member>
  -- NEW: an explicit participant sees THIS thread regardless of Space membership
  OR EXISTS (
    SELECT 1 FROM thread_participants caller_tp_space
     WHERE caller_tp_space.tenant_id = $tenantId
       AND caller_tp_space.thread_id = threads.id
       AND caller_tp_space.participant_type = 'user'
       AND caller_tp_space.user_id = $callerUserId
  )
)
```

Net effect: `(author OR participant) AND (space-ok OR participant)` → a participant always passes; an author still needs space-ok (behavior unchanged); a pure space-member who is neither author nor participant is still excluded by clause 1 (unchanged). The change is strictly additive — it only **grants** visibility to explicit participants, never broadens exposure to non-participants.

## Prevention

- **When a predicate ANDs a coarse scope (space/org/team membership) onto a fine-grained per-record grant (participant/share/invite), the coarse scope silently revokes the fine grant.** If the product model says "an explicit invite grants access," the invite must be sufficient on its own — express it as an `OR` escape, not gated behind the broader scope.
- **Check access-control changes against the predicate's own docstring/intent.** Here the code had drifted from its stated contract; the fix realigned them.
- **Least-privilege guard test without a DB:** the repo mocks `callerVisibleThreadPredicate` everywhere, so there's no behavioral SQL test. A cheap regression guard renders the predicate via `new PgDialect().sqlToQuery(...)` and asserts `thread_participants` appears **twice** (clause 1 + the space-clause bypass) — see `access.test.ts`. This catches accidental removal of the bypass without standing up Postgres.

## Related

- `docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md` — the client-side half of the same "tagged thread doesn't show up" investigation (the refetch fix that this predicate bug would have defeated for private Spaces).
