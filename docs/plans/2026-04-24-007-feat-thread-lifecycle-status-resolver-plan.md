---
title: Derived ThreadLifecycleStatus resolver (U4)
type: feat
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Derived ThreadLifecycleStatus resolver (U4)

## Overview

Add a read-only, pure-function-derived `Thread.lifecycleStatus: ThreadLifecycleStatus!` field to the GraphQL schema. The resolver computes one of `RUNNING | COMPLETED | CANCELLED | FAILED | IDLE` per request from `thread_turns` rows — no new columns, no caching. This unblocks U6's admin right-rail reshape, which needs a single canonical status badge that reflects agent activity (not the task-tracker status that U3 just dropped).

This slice extracts U4 verbatim from the parent plan (`docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`). Parent plan specified U4 should ship in the same PR as U3/U5, but U3 merged today (#531, #533, #535, #539) and U5 is gated on separate prerequisites (backups bucket shipped, destructive migration authored later), so U4 ships standalone.

---

## Problem Frame

U3 dropped the operator-authored `thread.status` surface (BACKLOG / TODO / IN_PROGRESS / IN_REVIEW / BLOCKED / DONE / CANCELLED). Admin and mobile UIs still need *some* status signal — specifically, one derived from agent activity (is this thread actively running? did the last run succeed or fail?). The signal lives in `thread_turns` already; U4 surfaces it as a computed GraphQL field.

Derivation must handle the `queued → running` handoff window (latest committed row may still be `succeeded` even though a new `queued` row was just inserted), stuck-dispatch cases (warm containers booting without env vars, per the AgentCore deploy race), and threads with zero turns.

---

## Requirements Trace

- R1. Add `enum ThreadLifecycleStatus { RUNNING COMPLETED CANCELLED FAILED IDLE AWAITING_USER }` to the canonical GraphQL schema. `AWAITING_USER` is reserved in the enum but not emitted by v1 (no input signal source exists today) — reserving the value avoids a schema break when it's wired later.
- R2. Add `thread.lifecycleStatus: ThreadLifecycleStatus!` (non-null) field.
- R3. Resolver derives the value from `thread_turns` per-request with no caching, no new columns.
- R4. Active-turn probe handles the `queued → running` handoff window: if a `queued` or `running` turn exists with `created_at > now() - interval '5 minutes'`, return `RUNNING`.
- R5. Freshness guard: `queued` turns older than 5 minutes (stuck dispatch) map to `FAILED`, pushing them to operator triage instead of hiding them as `RUNNING` forever.
- R6. Latest-row fallback: when the active probe finds nothing, map the most recent `thread_turns.status` per the fixed table (see Approach).
- R7. Tests cover every state transition plus the handoff-window edge case and the freshness-guard edge case.

**Origin requirements carried forward:** R7 (derived lifecycle status), R8 (UI reshape unblocked). See origin: `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`.

---

## Scope Boundaries

- Server-only. Admin + mobile UI rendering of the new field belongs to U6 (admin right-rail reshape) and U9 (mobile sweep).
- No `AWAITING_USER` emission in v1. Enum value reserved; resolver's test scenarios assert it is never returned.
- No new DB column — `lifecycleStatus` is a per-request computation from `thread_turns`. DB schema unchanged.
- No caching layer (in-memory, DataLoader, or otherwise). If query volume makes per-request derivation expensive, revisit in a follow-up — but the two SQL probes are indexed lookups on `thread_turns(thread_id, created_at)` and should be cheap enough.
- No subscription publisher for `lifecycleStatus` changes. Clients re-query via `thread(id)` or `threads(...)` on their existing refetch cadence. AppSync subscription schema stays untouched (same posture as U3's resolver-only drops).
- No cross-tenant probe — `requireTenantAdmin` gate on surrounding resolvers already bounds access.

---

## Context & Research

### Relevant Code and Patterns

- **`packages/database-pg/graphql/types/threads.graphql`** — where the enum + field are declared. Same file U3 just edited.
- **`packages/api/src/graphql/resolvers/threads/types.ts`** — Thread type's field-resolver block. Canonical location for computed per-field resolvers that sit alongside the row shape.
- **`packages/api/src/graphql/resolvers/threads/thread.query.ts`** — where a per-thread populated value could be pre-computed if field-resolver-per-request overhead is a concern. Leaning toward field resolver (per-request DataLoader batch) rather than per-thread populate because the value is needed only when the client selects it.
- **`packages/api/src/graphql/resolvers/threads/loaders.ts`** — existing DataLoader patterns for threadCommentCount (now removed) and similar per-thread aggregate queries. Add a new `threadLifecycleStatus` DataLoader here to batch probes across a `threadsPaged` request.
- **`packages/database-pg/src/schema/threadTurns.ts`** (confirm path during execution) — `thread_turns` status enum is `queued | running | succeeded | failed | cancelled | timed_out | skipped` (7 values). Resolver mapping table below collapses to 5 + 1-reserved GraphQL enum values.
- **`apps/admin/src/components/threads/LiveRunWidget.tsx:26-28`** — existing admin-side `queued | running → active` grouping. Server derivation should match this grouping to keep admin + server aligned when U6 renders the new field.
- **`packages/api/src/graphql/resolvers/threads/cancelThreadTurn.mutation.ts`** — uses a narrower "running only" check for cancel eligibility. Do NOT mirror that narrower check here; queued+running both map to RUNNING to match the widget.

### Institutional Learnings

- **`project_agentcore_deploy_race_env`** (auto-memory) — warm containers can boot pre-env-injection during terraform-apply, leaving `thread_turns` rows stuck in `queued` with "missing THINKWORK_API_URL". This is exactly the class of stuck-dispatch case the 5-minute freshness guard targets. Without the guard, the badge would latch to `RUNNING` forever on those threads.
- **`docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md`** — general pattern for shipping new compute surfaces inert alongside the consumer rollout. Not directly applicable (U4 is a single-PR feature), but the "observable before wiring" posture is worth carrying forward: ship the resolver with tests, let admin + mobile opt into it in U6/U9.

### External References

None — derivation logic is entirely local. GraphQL-Yoga field-resolver patterns are well-established in the codebase.

---

## Key Technical Decisions

- **Two-probe derivation, not a single UNION.** An active-turn probe runs first (`SELECT 1 ... WHERE status IN ('queued', 'running') AND created_at > now() - interval '5 minutes' LIMIT 1`). If it hits, return `RUNNING` immediately. If it misses, run the latest-row fallback (`SELECT status ... ORDER BY created_at DESC LIMIT 1`) and map per the table. Two lookups is simpler than a UNION with branching logic, and both hit the same `thread_turns(thread_id, created_at)` index.
- **5-minute freshness window on `queued`.** Mirrors the `project_agentcore_deploy_race_env` warm-container incident where `queued` rows can be stranded indefinitely. Value is hardcoded in `lifecycle-status.ts` as `QUEUED_FRESHNESS_MS = 5 * 60 * 1000`; defer "make it configurable" to a follow-up if operators want different thresholds per tenant.
- **Reserved `AWAITING_USER` enum value.** Present in the schema but never emitted. Tests assert the resolver never returns it. Reserving now avoids a breaking schema change when user-input-awaiting is wired in a future slice.
- **DataLoader batch over raw query per request.** `thread(id)` triggers one call; `threadsPaged(limit: 50)` would trigger 50 without batching. Add a DataLoader at `packages/api/src/graphql/resolvers/threads/loaders.ts` that batches thread IDs and runs two grouped SQL probes (one for active, one for latest-row).
- **Pure function for the mapping.** Extract the status-to-enum mapping into `packages/api/src/graphql/resolvers/threads/lifecycle-status.ts` as a plain function of `(activeTurnExists: boolean, latestTurn: { status: string; created_at: Date } | null)` so it's unit-testable without DB setup. Unit tests exercise every state transition; integration tests hit the resolver end-to-end.

---

## Open Questions

### Resolved During Planning

- **Where does the resolver live — on `Thread` type or inline in `thread.query.ts`?** Field resolver on `Thread` type (via `types.ts`). Matches the existing convention (e.g., `Thread.agent`, `Thread.attachments`) and lets the field be resolved lazily only when selected.
- **Cache per-request or per-thread?** Per-request DataLoader batch. Client selecting `lifecycleStatus` on 50 threads in `threadsPaged` fires one batched probe, not 50.
- **AWAITING_USER mapping — what signals it in v1?** Nothing. The enum value is reserved; resolver never returns it. Tests enforce this invariant.

### Deferred to Implementation

- **Exact DataLoader signature.** The batching join is known (`thread_ids → (active_probe_result, latest_turn_row)`); the precise Drizzle/SQL shape is execution-time work — depends on what `thread_turns` aggregate queries currently look like in the codebase.
- **Index verification.** `thread_turns(thread_id, created_at)` index is assumed present. Execution-time `\d thread_turns` check will confirm — if missing, add it in the same PR to keep the probes O(log n) per thread.

---

## Implementation Units

- U1. **Add enum + field to canonical GraphQL schema**

**Goal:** Declare `ThreadLifecycleStatus` enum + `thread.lifecycleStatus` field in the canonical GraphQL source. Regenerate codegen. No resolver yet — typecheck-only change to confirm the contract is valid.

**Requirements:** R1, R2.

**Dependencies:** None.

**Files:**
- Modify: `packages/database-pg/graphql/types/threads.graphql` (add enum; add `lifecycleStatus: ThreadLifecycleStatus!` to `type Thread`)
- Regenerate: `apps/admin/src/gql/*.ts`, `apps/mobile/lib/gql/*.ts`, `apps/cli/src/gql/graphql.ts`
- Run: `pnpm schema:build` (expect zero diff — lifecycleStatus is HTTP-side, not subscription)

**Approach:**
- Add enum with 6 values (`RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, `IDLE`, `AWAITING_USER`).
- Add field as non-null at the end of the `Thread` type (after `updatedAt`). Non-null enforces the contract that the resolver always has an answer; the "no turns" case maps to `IDLE`, not null.
- Temporarily stub the resolver if typecheck requires it (return `"IDLE"` placeholder) — U2 replaces the stub with real logic.

**Patterns to follow:** `ThreadStatus` enum already in the file.

**Test scenarios:**
- Test expectation: none — pure schema declaration. Typecheck + codegen regen covers the shape validity.

**Verification:**
- `pnpm schema:build` produces no `terraform/schema.graphql` diff.
- Codegen regen in admin/mobile/cli succeeds.
- `pnpm --filter @thinkwork/api typecheck` passes.

---

- U2. **Pure-function lifecycle derivation**

**Goal:** Extract the active-turn-probe + latest-row-fallback mapping into a pure function in its own file. Unit-tested without DB fixtures.

**Requirements:** R3, R4, R5, R6, R7.

**Dependencies:** U1.

**Files:**
- Create: `packages/api/src/graphql/resolvers/threads/lifecycle-status.ts`
- Create: `packages/api/src/__tests__/lifecycle-status.test.ts`

**Approach:**
- Export a pure function `deriveLifecycleStatus(input: { hasActiveTurn: boolean; latestTurn: { status: string; created_at: Date } | null; now?: Date }): ThreadLifecycleStatus`.
- Export a constant `QUEUED_FRESHNESS_MS = 5 * 60 * 1000`.
- Mapping table (applied when `hasActiveTurn === false`, otherwise `RUNNING`):

  | `latestTurn.status` | `hasActiveTurn` fresh (≤ 5 min) | Output |
  |---|---|---|
  | any | `true` | `RUNNING` |
  | `queued` | `false` (age > 5 min) | `FAILED` |
  | `running` | `false` (shouldn't happen if probe is correct; defensive) | `RUNNING` |
  | `succeeded` | `false` | `COMPLETED` |
  | `cancelled` | `false` | `CANCELLED` |
  | `failed` | `false` | `FAILED` |
  | `timed_out` | `false` | `FAILED` |
  | `skipped` | `false` | `IDLE` |
  | (null — no rows) | `false` | `IDLE` |

- Function injects `now` for testability (default `new Date()`).

**Execution note:** Test-first. Unit tests for the 9 mapping cases + the handoff-window edge case are written before the function body so the behavior spec is clear.

**Patterns to follow:**
- Pure-function-plus-table style seen elsewhere in `packages/api/src/lib/` (name a concrete reference during execution).
- Existing `packages/api/src/lib/orchestration/prompt-template.ts` `renderPromptTemplate` for "pure function + unit test" convention.

**Test scenarios:**
- Happy path: `hasActiveTurn=true, latestTurn=any` → `RUNNING`.
- Happy path: `latestTurn.status='succeeded'` → `COMPLETED`.
- Happy path: `latestTurn.status='cancelled'` → `CANCELLED` (user-initiated stop, distinct from system failure).
- Happy path: `latestTurn.status='failed'` → `FAILED`.
- Happy path: `latestTurn.status='timed_out'` → `FAILED`.
- Happy path: `latestTurn.status='skipped'` → `IDLE`.
- Edge case (freshness guard): `hasActiveTurn=false, latestTurn.status='queued', created_at > 5 min ago` → `FAILED`. Assertion proves the freshness predicate is applied when active probe missed but a stuck `queued` row is what the latest-row fallback finds.
- Edge case (no turns): `hasActiveTurn=false, latestTurn=null` → `IDLE`.
- Edge case (handoff window): `hasActiveTurn=true, latestTurn.status='succeeded'` (the committed history tail) → `RUNNING` (active probe wins).
- Edge case (defensive `running` fallback): `hasActiveTurn=false, latestTurn.status='running'` → `RUNNING`. Shouldn't happen in practice (active probe should have caught it), but the function stays defensive.
- Contract: enum never returns `AWAITING_USER` — assert by iterating every test scenario's output and confirming it's in `{RUNNING, COMPLETED, CANCELLED, FAILED, IDLE}`.
- Contract: enum exported constants match the GraphQL enum exactly (no drift).

**Verification:**
- `npx vitest run lifecycle-status.test.ts` — all tests green.
- `deriveLifecycleStatus` has no DB or time-of-day dependency — proven by tests using injected `now`.

---

- U3. **DataLoader-batched SQL probes + field resolver wiring**

**Goal:** Wire the pure function into the GraphQL resolver. Use a DataLoader so a single `threadsPaged` call doesn't fire N probes.

**Requirements:** R3, R4, R6.

**Dependencies:** U2.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/threads/loaders.ts` (add `threadLifecycleStatus` DataLoader)
- Modify: `packages/api/src/graphql/resolvers/threads/types.ts` (add `lifecycleStatus` field resolver on Thread type)
- Test: `packages/api/test/integration/threads/lifecycle-status.test.ts` (new integration test)

**Approach:**
- DataLoader `threadLifecycleStatusLoader(threadIds)`:
  1. Active probe: `SELECT thread_id FROM thread_turns WHERE thread_id = ANY($1) AND status IN ('queued', 'running') AND created_at > now() - interval '5 minutes'`. Build a `Set<threadId>` of IDs with an active turn.
  2. Latest-row probe: `SELECT DISTINCT ON (thread_id) thread_id, status, created_at FROM thread_turns WHERE thread_id = ANY($1) ORDER BY thread_id, created_at DESC`. Build a `Map<threadId, { status, created_at }>`.
  3. For each requested thread ID, call `deriveLifecycleStatus({ hasActiveTurn: activeSet.has(id), latestTurn: latestMap.get(id) ?? null })`.
- Field resolver on `Thread.lifecycleStatus` pulls the DataLoader from `ctx.loaders` (standard pattern) and returns `loader.load(parent.id)`.
- Replace the U1 stub.

**Execution note:** Integration test first. Seed `thread_turns` rows directly via Drizzle `insert`, query the thread via GraphQL, assert `lifecycleStatus` matches expectation for each scenario.

**Patterns to follow:**
- Existing DataLoaders in `packages/api/src/graphql/resolvers/threads/loaders.ts` — same batching shape for aggregate queries.
- Field resolver pattern on `Thread.agent`, `Thread.attachments` in `packages/api/src/graphql/resolvers/threads/types.ts`.

**Test scenarios:**
- Integration: thread with a fresh `queued` turn (created < 5 min ago) → `lifecycleStatus = RUNNING`.
- Integration: thread with a stuck `queued` turn (created > 5 min ago, `now()` mocked or fixture's `created_at` set far in the past) → `lifecycleStatus = FAILED`.
- Integration: thread with latest turn `succeeded` → `lifecycleStatus = COMPLETED`.
- Integration: thread with latest turn `failed` → `lifecycleStatus = FAILED`.
- Integration: thread with latest turn `cancelled` → `lifecycleStatus = CANCELLED`.
- Integration: thread with zero turns → `lifecycleStatus = IDLE`.
- Integration: thread with the handoff-window sequence (committed `succeeded` row plus a newer fresh `queued` row) → `lifecycleStatus = RUNNING`.
- Integration (batching): `threadsPaged(limit: 3)` where threads have distinct lifecycle states — assert all three states resolve correctly and the DataLoader fires exactly 2 SQL probes total (one active, one latest-row) regardless of the number of threads.
- Integration (no cross-tenant leak): seed turns on a thread in tenant B, query thread in tenant A — resolver should receive `null` for latestTurn (the row isn't in the caller's tenant scope via `requireTenantAdmin` on the parent query).

**Verification:**
- `packages/api` full test suite passes (baseline count + new tests).
- `lifecycleStatus` resolves correctly on `thread(id)` and batched on `threadsPaged(...)`.
- AppSync schema unchanged (`pnpm schema:build` no diff).

---

## System-Wide Impact

- **Interaction graph:** Resolver fires on every `thread(id)` or `threadsPaged(...)` query that selects `lifecycleStatus`. No writes, no mutations, no scheduled jobs touched.
- **Error propagation:** If the DataLoader's SQL probe fails, the field resolver throws — GraphQL returns a field-level error while the rest of the thread payload succeeds (standard Yoga behavior). No callers depend on this field today (U6/U9 wire it later), so a transient failure affects no live UI.
- **State lifecycle risks:** None. Pure read path over existing rows.
- **API surface parity:** Admin and mobile both get the field via their respective GraphQL consumers. U6 (admin right-rail) and U9 (mobile sweep) wire the display — out of scope here.
- **Integration coverage:** Covered by U3's integration tests + the DataLoader batching assertion.
- **Unchanged invariants:** `thread.status` (the dropped task-tracker field) stays removed. `thread_turns` schema untouched. No new migrations.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `thread_turns(thread_id, created_at)` index missing — probes degrade to seq scan on large tenants | Execution-time `\d thread_turns` check; add the index in the same PR if missing |
| 5-minute freshness threshold too aggressive for slow AgentCore cold starts | Start at 5 min (matches U3d precedent in `project_agentcore_deploy_race_env`); revisit if operators report false `FAILED` tags |
| `cancelled` vs `timed_out` vs `failed` semantic drift in existing `thread_turns.status` enum | Mapping table is explicit; any new `thread_turns.status` value surfaces as a resolver crash (defensive — forces authors to update the mapping when introducing a new turn state) |
| DataLoader state leaks across requests | Loader scoped to `ctx.loaders`, which is per-request per Yoga convention. Confirm in U3 integration test by asserting two parallel requests see independent DataLoader instances |

---

## Documentation / Operational Notes

- PR body should note U4 ships inert — no admin/mobile consumer wired yet. U6 and U9 pick up the field.
- No deploy ordering required. Server field is additive; older clients that don't select it are unaffected.
- No new env vars, no Terraform changes.

---

## Sources & References

- **Parent plan:** [docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md](./2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md) (U4 section)
- **Related PRs (predecessor slices merged today):** #531 (U3a), #533 (U3b), #535 (U3c), #539 (U3d + U3e), #545 (process-materializer fix)
- **Related code:** `packages/api/src/graphql/resolvers/threads/loaders.ts`, `apps/admin/src/components/threads/LiveRunWidget.tsx`
- **Memory:** `project_agentcore_deploy_race_env` (AgentCore deploy race stranded-queued rows)
