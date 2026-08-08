# Hand-seeded thread broke ALL thread creation on dev — issue_counter must be bumped with any direct insert

**Date:** 2026-08-07 (root cause identified 2026-08-08) · **Linear:** THINK-712 · **Stage:** dev

## Symptom

Every `createThread` on dev failed with the UI showing `[GraphQL] Unexpected error.` and the `graphql-http` Lambda logging:

```
error: duplicate key value violates unique constraint "uq_threads_tenant_number"
    at ... Object.umr [as createThread]
```

No code had changed; the failure appeared between two dogfood sessions on the same day.

## Root cause

`packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` allocates thread numbers by atomically incrementing `tenants.issue_counter` and inserting inside one transaction — as do all other in-repo thread writers (searchAsk, searchResearch, slack thread-mapping, automation-builder, cold-contact, customer-onboarding). None can produce skew.

The skew came from **outside code**: the TestFlight/Apple-review citation fixture **CHAT-1962** was hand-seeded with a direct Aurora insert that set `number = 1962` while `issue_counter` stayed at 1961. Every subsequent `createThread` therefore minted 1962 → collision, on every attempt, forever.

## Diagnosis path (reusable)

```sql
select t.id, t.issue_counter,
       (select max(number) from threads th where th.tenant_id = t.id) as max_thread_number
from tenants t;
```

`issue_counter < max_thread_number` for any tenant = this failure mode. (`threads` is the only table with a per-tenant `number` column, so the check is complete.)

## Fix

```sql
update tenants
set issue_counter = (select max(number) from threads th where th.tenant_id = tenants.id)
where issue_counter < (select max(number) from threads th where th.tenant_id = tenants.id);
```

Applied via RDS Data API against `thinkwork-dev-db`; thread creation verified working immediately after.

## Rule going forward

**Any hand-inserted `threads` row must bump `tenants.issue_counter` to the inserted `number` in the same operation.** Seeding checklists that already exist (visibility via `threads.user_id`, `channel='chat'`, valid `space_id`) now include this. No defensive code change was warranted for a single seeding mistake — the atomic allocator is correct.
