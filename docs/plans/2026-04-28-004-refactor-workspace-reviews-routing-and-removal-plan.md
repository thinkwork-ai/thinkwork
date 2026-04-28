---
title: "refactor: Route workspace reviews by responsibility and remove standalone admin page"
type: refactor
status: completed
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md
---

# refactor: Route workspace reviews by responsibility and remove standalone admin page

## Overview

Replace the tenant-wide `/workspace-reviews` admin page with responsibility-based routing. Workspace reviews owned by a paired human (directly or via the `parent_agent_id` chain) surface only on that human's mobile Threads. Reviews whose agent chain terminates at `agents.source = 'system'` surface as items in the existing **Inbox** (the same machinery that originally served the retired tasks system) — they materialize as `inbox_items` rows with `type='workspace_review'`. The standalone admin page is deleted once the new surfaces achieve parity.

System-HITL was originally planned to live as a tab on Automations. Routing it through Inbox instead is a better fit: Inbox already has the right shape (Approve / Reject / Request revision actions, comments, activity log, status transitions) and was effectively dead code after tasks were retired. Reusing it avoids building a parallel queue UI and frees Inbox from being a vestigial surface.

As part of this slice, **Automations is promoted from the Manage group to the Work group** in the admin sidebar, sitting **below Inbox**. Inbox keeps its existing position and naturally surfaces the new system-review items via its existing pending-count badge. Manage retains pure config/infra surfaces (Analytics, Webhooks, People, Billing).

This is a routing-and-isolation refactor, not a new feature. The data model already supports it; the resolver, mobile filter, inbox materialization hook, inbox→workspace mutation bridge, and sidebar grouping do not. There is no schema change for routing — classification is computed read-time from existing columns (`agents.parent_agent_id`, `agents.human_pair_id`, `agents.source`). Inbox materialization writes to the existing `inbox_items` table.

---

## Problem Frame

The admin app's `/workspace-reviews` page lists every `awaiting_review` workspace run for the current tenant, regardless of which human is responsible for resolving it. At enterprise scale (4 enterprises × 100+ agents × ~5 templates) that's a wall of unrelated reviews, and on mobile the same query returns all reviews in the tenant — so paired humans currently see each other's pending HITL pauses. That violates ThinkWork's "user-personal goes to mobile, admin owns infra" stance and creates a real isolation gap.

The brainstorm (origin: `docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md`) commits to a clean split: paired-human HITL on mobile, system-agent HITL in admin Inbox, no standalone page. This plan implements that split. The original brainstorm framed the admin home as "Automations"; investigation during U2 surfaced that the Inbox machinery was a much better fit (existing UI, retired-task surface looking for purpose), and that pivot is captured here.

---

## Requirements Trace

- R1. Paired-human reviews (direct or via parent chain) surface only on that human's mobile Threads — not in admin.
- R2. System-agent reviews (chain terminates at `source='system'`, no `human_pair_id` anywhere) surface only in admin Inbox as `inbox_items` rows with `type='workspace_review'`.
- R3. Inbox sidebar entry's existing pending-count badge naturally includes pending system-agent reviews (since they materialize as inbox items). No new badge surface.
- R4. System HITL items render in the existing Inbox UI (`/inbox` and `/inbox/$inboxItemId`) with type-aware payload rendering and the existing Approve / Reject / Request revision actions. No new route, no new queue UI.
- R5. `/workspace-reviews` route, sidebar entry, and component removed once parity verified.
- R10. Automations sidebar entry moves from the Manage group to the Work group, positioned **below Inbox**. Final Work order: Dashboard, Threads, Inbox, Automations. Manage keeps pure config/infra surfaces.
- R11. Inbox decisions on `type='workspace_review'` items dispatch the existing workspace review mutations server-side: Approve → `acceptAgentWorkspaceReview`; Reject → `cancelAgentWorkspaceReview`; Request revision → `resumeAgentWorkspaceRun` with the review notes carried as `responseMarkdown`. Clients keep calling the inbox mutation surface only.
- R12. Materialization is idempotent: replaying the same `review.requested` event for the same run does not produce duplicate inbox items.
- R6. Classification is deterministic from the database alone (no S3 reads).
- R7. Cross-user isolation: no user can see another user's pending review through any surface.
- R8. Existing review-resolution mutations (`acceptAgentWorkspaceReview`, `cancelAgentWorkspaceReview`, `resumeAgentWorkspaceRun`) work unchanged.
- R9. Documentation reflects the new routing model.

**Origin actors:** Paired human, Tenant operator (admin), System agent, Sub-agent.
**Origin flows:** F-A (paired-human resolution), F-B (system-agent resolution), F-C (cutover from current page).
**Origin acceptance examples:** AE1 (paired direct), AE2 (sub-agent via parent chain), AE3 (system-agent badge), AE4 (admin operator action does not bleed to mobile), AE5 (route 404 after cutover).

---

## Scope Boundaries

- No changes to review file format, S3 paths, event types, or mutation contracts.
- No new sidebar group; reuses existing Work / Manage groupings.
- No cross-tenant or platform-admin views.
- No schema migration — classification is read-time.
- No backfill of historical runs.
- No "cover for absent user" escalation flow (deferred per origin).

### Deferred to Follow-Up Work

- **Push notification on review arrival** — when a paired human's mobile gains a new pending review. Likely valuable, not blocking this slice; scope as a separate plan.
- **Audit/escalation surface for tenant admins** — a power-user "all reviews in tenant" view if a real need surfaces. Reachable via direct GraphQL query for now.
- **Read-time → denormalized chain walk migration** — only if perf data shows the recursive walk is hot. v1 is read-time.

---

## Context & Research

### Relevant Code and Patterns

- **Schema:** `packages/database-pg/src/schema/agent-workspace-events.ts` — `agent_workspace_runs` (status, agent_id, parent_run_id, current_thread_turn_id), `agent_workspace_events`.
- **Schema:** `packages/database-pg/src/schema/agents.ts:42-50` — `agents.source` ('user'|'system'), `agents.parent_agent_id`, `agents.human_pair_id`.
- **Resolver:** `packages/api/src/graphql/resolvers/workspace/agentWorkspaceReviews.query.ts` — current tenant-wide query; already accepts optional `agentId`.
- **Resolver helpers:** `packages/api/src/lib/workspace-events/review-detail.ts`, `packages/api/src/lib/workspace-events/review-actions.ts` — read/write paths to keep working.
- **Pattern (user-scoping):** `packages/api/src/graphql/resolvers/agents/agents.query.ts:20` — `agents` resolver already filters by `human_pair_id = callerUserId`. Same pattern transfers to reviews.
- **Pattern (user scope guard):** `packages/api/src/graphql/resolvers/core/require-user-scope.ts:80` — established convention for resolving the responsible user from an agent and erroring on null pair.
- **Admin sidebar:** `apps/admin/src/components/Sidebar.tsx:202-216` (workItems, includes Workspace Reviews to be removed) and `:230-235` (manageItems with Automations entry pointing to `/scheduled-jobs`).
- **Admin Automations page:** `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` — existing DataTable surface where the system HITL tab will live.
- **Admin standalone page (to remove):** `apps/admin/src/routes/_authed/_tenant/workspace-reviews/index.tsx`, plus `apps/admin/src/lib/workspace-review-state.ts` (decision label/action helpers — likely keep, mobile reuses similar logic).
- **Mobile current HITL surface:** `apps/mobile/app/(tabs)/index.tsx:233` (calls `agentWorkspaceReviews` with no user filter — currently leaks across users), `apps/mobile/app/thread/[threadId]/index.tsx` (in-thread confirmation card).
- **GraphQL source:** `packages/database-pg/graphql/types/*.graphql` — canonical schema; consumers regenerate via `pnpm --filter @thinkwork/<name> codegen`.

### Institutional Learnings

- `feedback_oauth_tenant_resolver` — `ctx.auth.tenantId` is null for Google-federated users; use `resolveCallerTenantId(ctx)` fallback. Same applies to user id in the new responsible-user filter — must work for Google-federated callers.
- `feedback_user_opt_in_over_admin_config` — Aligns directly with this slice. Per-user surfaces belong on mobile; admin owns infra/ops.
- `feedback_pr_target_main` and `feedback_worktree_isolation` — Apply to landing this in multiple PRs (one per unit or per logical pair).
- `project_thinkwork_supersedes_maniflow` — Naming conventions; not directly affected here but watch for stale `maniflow*` strings if they appear.

### External References

None required. The pattern is internal: existing `agents.query.ts` user-scoping, existing review resolvers, existing GraphQL conventions. No new framework or external API surface.

---

## Key Technical Decisions

- **Read-time chain walk, not denormalized column.** Resolver walks `parent_agent_id` recursively until it finds an agent with `human_pair_id` set or hits a `source='system'` agent. Rationale: no migration risk, simpler schema, scale-appropriate (per-tenant pending counts are small, per-user filters are bounded). If perf data later shows recursive CTE is hot, denormalize as a follow-up — but `agents.human_pair_id` reassignment would then require careful re-population.
- **Chain walk implemented as a single recursive Postgres CTE per query**, not N+1 application-level walks. Walk is bounded by `agents.depth` semantics (sub-agent depth ≤ 4 per existing routing limits — verify in CTE termination).
- **Classification fields exposed on the GraphQL row.** Add `responsibleUserId: ID` and `kind: WorkspaceReviewKind` (`paired | system | unrouted`) to the `AgentWorkspaceReview` type. Mobile and admin filter on these rather than re-deriving client-side.
- **Mobile auto-scopes to caller.** Mobile passes `responsibleUserId: callerUserId`. The resolver enforces this — passing another user's id is a permission boundary error, not a quiet no-op.
- **System reviews materialize as inbox items.** When the workspace event processor handles a `review.requested` event AND the run's classification is `system`, it inserts an `inbox_items` row with `type='workspace_review'`, `entity_type='agent_workspace_run'`, `entity_id=run.id`, `status='pending'`, derived title/description, and `config` carrying the review payload (review body, proposed changes, review object key). Rationale: the existing Inbox UI already has the right shape (Approve / Reject / Request revision actions, comments, activity log, status transitions) and was effectively dead code after tasks were retired; reusing it avoids building a parallel queue.
- **Inbox decisions bridge to workspace review mutations server-side.** `approveInboxItem` / `rejectInboxItem` / `requestRevisionInboxItem` mutations check `item.type === 'workspace_review'` and dispatch `acceptAgentWorkspaceReview` / `cancelAgentWorkspaceReview` / `resumeAgentWorkspaceRun(responseMarkdown=review_notes)` against `entity_id`. Clients call only the inbox mutations; the bridge runs inside the existing inbox resolvers. Existing workspace review mutation contracts unchanged (R8).
- **Materialization idempotency.** The materialization hook checks for an existing `inbox_items` row with matching `entity_type='agent_workspace_run'` and `entity_id=run.id` before inserting. Replaying a `review.requested` event for the same run does not produce duplicate inbox items.
- **State synchronization on review resolution.** When a workspace run's review.responded / cancellation events fire, the matching inbox item's `status`, `decided_by`, `decided_at`, and `review_notes` are updated. The workspace run remains the source of truth for the underlying agent state; the inbox row is a projection kept in sync.
- **Backfill for existing pending system reviews.** A one-shot script materializes inbox items for any current `awaiting_review` runs that classify as `system` and don't already have a linked inbox row. Run before deleting `/workspace-reviews`.
- **Unrouted classification surfaces, doesn't drop.** If chain has neither a `human_pair_id` nor a `source='system'` terminator (orphan or cycle), `kind='unrouted'`. These materialize as inbox items too (so they're visible to operators) with a clear warning marker in the title/description.
- **Cycle and depth bound.** Chain walk caps at depth 8 with a hard error if exceeded. Real chains shouldn't exceed 4; the cap exists to surface bad data, not to support deep nesting.
- **Cutover ordering: new surfaces ship first, page deletion last.** A pre-deletion verification query (one-shot SQL) confirms every current `awaiting_review` system run has a corresponding inbox item, with zero rows that would become invisible.

---

## Open Questions

### Resolved During Planning

- **Read-time vs denormalized chain walk** → read-time CTE; denormalize only if proven hot.
- **Where system HITL lives in admin** → existing Inbox (`/inbox`), as `inbox_items` rows with `type='workspace_review'`. Reuses the existing UI and frees Inbox from being a vestigial post-tasks surface.
- **Inbox action mapping** → Approve → `acceptAgentWorkspaceReview`; Reject → `cancelAgentWorkspaceReview`; Request revision → `resumeAgentWorkspaceRun` with notes carried as `responseMarkdown`. Resume's existing "wake without approving content" semantics fit revision-with-notes naturally.
- **Inbox materialization timing** → write-time, in the workspace event processor when `review.requested` is canonicalized AND classification is `system`.
- **Mobile filter mechanism** → resolver enforces `responsibleUserId = callerUserId` for mobile callers (mobile passes its own id; resolver validates).
- **What happens to current pending reviews during cutover** → backfill script materializes inbox items for any pending system run that doesn't have one. Pre-deletion verification query is the gate.
- **Unrouted reviews (orphan/cycle)** → classify as `unrouted`; materialize as inbox items with a warning marker in the title so operators can investigate.
- **Sub-agent label in parent's mobile thread** → "Sub-agent {agent.name} needs your input on {target_path}" (override default review title when run.agent_id ≠ responsible-chain origin).

### Deferred to Implementation

- **Exact recursive CTE shape and Drizzle expression** for the chain walk — depends on what the Drizzle SQL builder cleanly supports vs. raw `sql` template. Worth comparing both during U1. *(Resolved in #674 — used raw `sql` template; recursive CTE in `classify-review.ts`.)*
- **Whether `apps/admin/src/lib/workspace-review-state.ts` is reused on mobile** — verify during U3 whether mobile already imports it; if so, factor before deleting any of it in U5. *(Resolved in #677 — mobile has its own equivalent; admin file stays untouched until U5 page-deletion review.)*
- **Inbox materialization hook location** — `packages/api/src/lib/workspace-events/processor.ts` vs the dispatcher Lambda. Verify during U4; the run-state update path is the natural insertion point.
- **Inbox row title/description copy** — derive from review file reason + agent slug + target path. Iterate during U4 implementation.
- **Whether `/workspace-reviews` returns a 404 or redirects to `/inbox`** — TanStack Router supports both. Lean redirect for muscle memory; decide during U5.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Classification flow

```
agent_workspace_runs row (status='awaiting_review')
        │
        ▼
recursive CTE: walk agents.parent_agent_id starting from run.agent_id
        │
        ├─ find first agent with human_pair_id NOT NULL
        │       └─ kind='paired', responsibleUserId=that human_pair_id
        │
        ├─ chain terminates (parent_agent_id IS NULL) at source='system'
        │       └─ kind='system', responsibleUserId=null
        │
        ├─ chain terminates at source='user' but human_pair_id IS NULL
        │       └─ kind='unrouted', responsibleUserId=null  (orphan)
        │
        └─ depth > 8 (cycle / bad data)
                └─ kind='unrouted', responsibleUserId=null  (with log)
```

### Surface routing

```
GraphQL agentWorkspaceReviews(tenantId, responsibleUserId?, kind?, status?, limit?)
        │
        ├─ Mobile call: responsibleUserId=ctx.auth.userId, kind not set
        │       └─ rows where chain resolves to caller (paired only)
        │
        └─ Admin: not used as a list surface anymore — Inbox is the surface.
                  agentWorkspaceReview(runId) is still used to render
                  decision detail when an inbox item links to a run.

System review materialization (write-time, in workspace event processor):
        │
        review.requested + classification = 'system' / 'unrouted'
        ├─ check existing inbox_items WHERE entity_id=run.id  (idempotency)
        └─ INSERT inbox_items {
             type: 'workspace_review',
             status: 'pending',
             entity_type: 'agent_workspace_run',
             entity_id: run.id,
             title: derived from agent + target,
             config: { reviewBody, proposedChanges, reviewObjectKey }
           }

Inbox decision dispatch (server-side, in inbox mutations):
        │
        ├─ approveInboxItem  → acceptAgentWorkspaceReview(entity_id)
        ├─ rejectInboxItem   → cancelAgentWorkspaceReview(entity_id)
        └─ requestRevisionInboxItem → resumeAgentWorkspaceRun(
                                         entity_id,
                                         responseMarkdown: review_notes
                                      )

GraphQL pendingSystemReviewsCount(tenantId) → Int
        │
        └─ Sidebar.tsx Automations entry badge
```

---

## Implementation Units

- U1. **Chain-walk classifier (server-side helper)**

**Goal:** Add a pure, well-tested helper that classifies a workspace run row by walking the agent chain and returns `{ kind, responsibleUserId }`. Ship inert — not yet wired into any resolver.

**Requirements:** R6, R7, R2, R1.

**Dependencies:** None.

**Files:**
- Create: `packages/api/src/lib/workspace-events/classify-review.ts`
- Test: `packages/api/src/__tests__/classify-review.test.ts`

**Approach:**
- Export `classifyWorkspaceReview(db, { tenantId, agentId })` returning `{ kind: 'paired'|'system'|'unrouted', responsibleUserId: string | null }`.
- Use a single recursive CTE over `agents` starting at `agentId`, ascending via `parent_agent_id`. Project `human_pair_id` and `source` at each level.
- First level with `human_pair_id IS NOT NULL` → `paired`.
- Chain terminator (`parent_agent_id IS NULL`) classified by `source`: `'system' → system`, `'user' → unrouted`.
- Depth cap 8 with explicit error path → return `unrouted` and log a structured warning.
- Use Drizzle's `sql` template for the recursive CTE; keep tenant_id in the join to preserve isolation.
- No GraphQL changes in this unit. Pure helper.

**Execution note:** Test-first. The classification matrix is the contract; build it as a table-driven test suite before writing the CTE.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/core/require-user-scope.ts:68-93` — established pattern of querying agent fields by id with tenant scoping; mirror the structure.
- Existing recursive query usage in `packages/api/src/lib/` if any; otherwise raw `sql` template per Drizzle docs.

**Test scenarios:**
- Happy path: agent with `human_pair_id` set, no parent → `paired`, returns that user id.
- Happy path: sub-agent (parent has `human_pair_id`) → `paired`, returns parent's user id. *Covers AE2.*
- Happy path: deep chain (3 levels) where only grandparent has `human_pair_id` → `paired`, returns grandparent's user.
- Happy path: agent with `parent_agent_id IS NULL` and `source='system'`, no `human_pair_id` → `system`, `responsibleUserId=null`. *Covers AE3.*
- Edge case: agent with `parent_agent_id IS NULL`, `source='user'`, `human_pair_id IS NULL` → `unrouted` (orphan).
- Edge case: chain hits a `source='system'` agent before any `human_pair_id` → `system`.
- Edge case: tenant_id mismatch (agent row exists but in another tenant) → returns `unrouted` with no rows traversed; never returns rows from the wrong tenant.
- Error path: cycle in chain (parent A → B → A) → terminates at depth cap, returns `unrouted` with structured log entry.
- Error path: `parent_agent_id` references a deleted/missing row → terminates, classifies by deepest reachable agent.
- Edge case: chain depth exactly 8 → resolves normally; depth 9 → caps and returns `unrouted`.

**Verification:**
- `classifyWorkspaceReview` returns deterministic results for every row in a hand-built test fixture covering the matrix above.
- No DB row outside the queried tenant is ever returned.
- Helper is exported but not yet imported anywhere in resolvers (inert).

---

- U2. **Resolver: classification fields, filter args, and system count query**

**Goal:** Wire U1 into `agentWorkspaceReviews`, expose `responsibleUserId` and `kind` on the GraphQL row, accept `responsibleUserId` and `kind` as filter args, and add a lightweight `pendingSystemReviewsCount` query for the Automations badge.

**Requirements:** R1, R2, R3, R6, R7, R8.

**Dependencies:** U1.

**Files:**
- Modify: `packages/database-pg/graphql/types/agent-workspace-review.graphql` (or wherever the type is currently defined — verify; may live in a shared types file)
- Modify: `packages/api/src/graphql/resolvers/workspace/agentWorkspaceReviews.query.ts`
- Modify: `packages/api/src/graphql/resolvers/workspace/agentWorkspaceReview.query.ts` (single-row variant — same fields)
- Modify: `packages/api/src/graphql/resolvers/workspace/index.ts` (register new count resolver)
- Create: `packages/api/src/graphql/resolvers/workspace/pendingSystemReviewsCount.query.ts`
- Test: `packages/api/src/__tests__/agentWorkspaceReviews-routing.test.ts`
- Test: `packages/api/src/__tests__/pendingSystemReviewsCount.test.ts`
- Run: `pnpm schema:build` and `pnpm --filter @thinkwork/<each-consumer> codegen` for `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` — captured in unit verification.

**Approach:**
- Extend `AgentWorkspaceReview` type with `responsibleUserId: ID` and `kind: WorkspaceReviewKind!` (enum: `PAIRED | SYSTEM | UNROUTED`).
- Resolver runs a single classification join: extend the existing run-fetch CTE / select to include `responsibleUserId` and `kind` derived per row using U1's logic (inline the CTE if the helper isn't directly composable; verify during implementation).
- Accept new filter args:
  - `responsibleUserId: ID` — filter to rows where chain resolves to this user. When set and != caller's user id, require admin role (or just ignore — decide during impl; lean: require admin).
  - `kind: WorkspaceReviewKind` — filter to rows of this classification.
- `pendingSystemReviewsCount(tenantId)` returns `Int!` — count of `awaiting_review` rows whose chain classifies as `system` (and optionally `unrouted` — confirm during impl).
- Preserve all existing behavior: tenant member auth, status filter, agent filter, ordering, limit cap.
- Mutations (`acceptAgentWorkspaceReview`, `cancelAgentWorkspaceReview`, `resumeAgentWorkspaceRun`) unchanged — only the read path classifies.

**Execution note:** Test-first for the resolver-level routing matrix. Use integration tests against a test DB rather than mocks, per `feedback_dont_mock_db_in_integration_tests` if applicable.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/agents.query.ts:20` — `human_pair_id = callerUserId` filter pattern.
- `packages/api/src/graphql/resolvers/workspace/agentWorkspaceReviews.query.ts` — preserve current shape, add fields.

**Test scenarios:**
- Happy path: caller passes `responsibleUserId=callerUserId` → returns only paired rows belonging to that user. *Covers AE1.*
- Happy path: caller passes `kind=SYSTEM` (admin role) → returns only system-kind rows. *Covers AE3.*
- Happy path: row's `responsibleUserId` and `kind` fields match U1's classification for fixtures spanning paired/system/unrouted.
- Edge case: `responsibleUserId` arg + `kind=PAIRED` is internally consistent and returns expected rows.
- Edge case: `pendingSystemReviewsCount` excludes rows that have a paired user even when chain is long.
- Error path: caller is tenant member but passes `responsibleUserId` of a different user without admin role → returns empty (or rejects with permission error — confirm during impl).
- Error path: caller is not a tenant member → existing `requireTenantMember` rejects.
- Integration: a sub-agent run's row exposes `responsibleUserId = parent's human_pair_id`, even though the run's `agent_id` has `human_pair_id IS NULL`. *Covers AE2.*
- Integration: `pendingSystemReviewsCount` matches `count(*)` against a hand-classified fixture for the test tenant.
- Codegen: regenerated GraphQL types in `apps/admin/src/gql/`, `apps/mobile/...`, `apps/cli/src/gql/`, `packages/api/...` include the new fields and enum.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes for new resolver tests.
- `pnpm schema:build` produces a clean diff in `terraform/schema.graphql` reflecting the new type fields.
- Codegen runs cleanly across all consumers; no manual GraphQL edits in generated files.

---

- U3. **Mobile: scope reviews to the calling user via parent chain**

**Goal:** Update mobile's HITL surfaces to filter on `responsibleUserId = callerUserId`, so paired humans see only their own reviews — including sub-agent reviews routed via `parent_agent_id`. Adjust thread-detail rendering so a sub-agent review surfaces in the parent owner's mobile even when the sub-agent's thread isn't otherwise visible to that user.

**Requirements:** R1, R7.

**Dependencies:** U2.

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (Threads tab list + HITL count)
- Modify: `apps/mobile/app/thread/[threadId]/index.tsx` (in-thread confirmation card)
- Modify: `apps/mobile/components/...` — any other component reading `agentWorkspaceReviews` (verify with grep during impl)
- Modify: `apps/mobile/lib/...` (mobile-side review-state helpers if they need a parent-chain-aware label)
- Test: `apps/mobile/__tests__/workspace-review-routing.test.ts` (or align with existing mobile test path conventions)

**Approach:**
- Update the `agentWorkspaceReviews` query usage to pass `responsibleUserId: caller.userId`.
- Use `resolveCallerUserId(ctx)` equivalent on the mobile auth side — Google-federated callers must still work (`feedback_oauth_tenant_resolver`).
- For sub-agent reviews surfacing in the parent's mobile, use the new `responsibleUserId` field to drive the "Needs answer" treatment regardless of whether the user is a participant in the sub-agent's thread turn. The thread to surface in is the *parent* run's thread (resolved via `current_thread_turn_id` on the parent run, or via dedicated `subAgentReviewParentThreadId` field if the resolver derives it — TBD during impl).
- Sub-agent review label override: when `run.agent_id`'s human pair is null but chain resolves to caller, show "Sub-agent {agent.name} needs your input on {target_path}" instead of the default review title.

**Patterns to follow:**
- `apps/admin/src/lib/workspace-review-state.ts` — decision label/action helpers; mobile likely already has equivalent. Don't fork; share where reasonable.
- Existing mobile thread-list ordering for HITL items (per `docs/plans/2026-04-26-005-docs-mobile-hitl-process-plan.md`) — preserve "sort to top" + "Needs answer" treatment.

**Test scenarios:**
- Happy path: User A signed in; query returns only A's paired reviews. User B's reviews never appear. *Covers AE1, R7.*
- Happy path: A sub-agent of A's owned agent triggers a review; appears in A's mobile thread list with the parent agent's thread context. *Covers AE2.*
- Edge case: User A has zero pending reviews; HITL count is 0 and no "Needs answer" badges show.
- Edge case: System-agent review present in tenant; A sees nothing on mobile. *Covers AE3, AE4.*
- Edge case: Sub-agent review where parent chain goes A → A's-agent → A's-sub-agent → A's-sub-sub-agent. Surfaces in A's mobile.
- Error path: Auth context lacks userId (Google-federated edge) → query falls back via `resolveCallerUserId`; never returns an unscoped result.
- Integration: Approve/Continue/Reject in-thread invokes existing mutations and resolves the run state correctly (regression test for R8).
- Integration: After a paired review is approved, A's HITL count decrements; B's mobile is unaffected. *Covers AE4.*

**Verification:**
- Mobile tests for routing pass.
- Manual smoke in dev: log in as two users (A and B), trigger reviews owned by each, confirm A sees only A's, B sees only B's.

---

- U4. **Materialize system reviews as inbox items + bridge inbox actions + Automations sidebar move**

**Goal:** When a workspace run becomes `awaiting_review` and classifies as `system` (or `unrouted`), write a corresponding `inbox_items` row with `type='workspace_review'`. When operators decide that inbox item via Approve / Reject / Request revision, dispatch the matching workspace review mutation as a server-side side effect so the underlying run state advances. Add a type-aware Inbox payload renderer so reviewers can see the review body and proposed changes in the existing Inbox detail UI. Move the Automations sidebar entry from Manage to Work, positioned below Inbox.

**Requirements:** R2, R3, R4, R8, R10, R11, R12.

**Dependencies:** U2.

**Files:**
- Modify: `packages/api/src/lib/workspace-events/processor.ts` (or wherever `review.requested` event handling persists run state — verify) — when a run transitions to `awaiting_review`, run the U1 classifier; if `kind` is `system` or `unrouted`, INSERT inbox row (idempotency-checked).
- Modify: same processor — when a run resolves (`review.responded`, run cancelled, run failed/completed) and a linked inbox item exists, UPDATE its status + `decided_by` + `decided_at` + `review_notes`.
- Modify: `packages/api/src/graphql/resolvers/inbox/approveInboxItem.mutation.ts` — when item.type='workspace_review' and entity_type='agent_workspace_run', call the existing `acceptAgentWorkspaceReview` flow against `entity_id` (carry `review_notes` if present).
- Modify: `packages/api/src/graphql/resolvers/inbox/rejectInboxItem.mutation.ts` — same pattern, dispatch to `cancelAgentWorkspaceReview`.
- Modify: `packages/api/src/graphql/resolvers/inbox/requestRevisionInboxItem.mutation.ts` (or whichever inbox mutation file holds the revision flow — verify) — same pattern, dispatch to `resumeAgentWorkspaceRun({ responseMarkdown: review_notes, notes: review_notes })`.
- Modify: `apps/admin/src/components/inbox/InboxItemPayload.tsx` — register a renderer for `type='workspace_review'` that shows review body (markdown) and a proposed-changes preview (count + first 3, with diff snippet).
- Modify: `apps/admin/src/components/inbox/InboxItemPayload.tsx` — add `typeLabel['workspace_review'] = "Workspace review"` and a sensible `typeIcon`.
- Modify: `apps/admin/src/components/Sidebar.tsx` — remove `{ to: "/scheduled-jobs", icon: CalendarClock, label: "Automations" }` from `manageItems` and insert it into `workItems` after the Inbox entry. Final `workItems` order: Dashboard, Threads, Inbox, Automations. Final `manageItems` order: Analytics, Webhooks, People, (Billing if owner).
- Create: `packages/api/scripts/backfill-system-reviews-to-inbox.ts` — one-shot script that selects all `awaiting_review` runs, classifies each, and inserts inbox items for `system`/`unrouted` runs that don't already have a linked row. Idempotent.
- Test: `packages/api/src/__tests__/workspace-review-inbox-materialization.test.ts` — materialization, idempotency, status sync.
- Test: `packages/api/src/__tests__/workspace-review-inbox-bridge.test.ts` — Approve/Reject/RequestRevision dispatch correctly to the workspace review mutations.
- Test: `apps/admin/src/components/inbox/__tests__/InboxItemPayload.workspace-review.test.tsx` — payload renderer.
- Test: `apps/admin/src/lib/__tests__/sidebar-layout.test.ts` (or existing convention) — Automations is in workItems, position 4; not in manageItems.

**Approach:**
- **Materialization hook**: extend the workspace-event processor's run-state update path (where `awaiting_review` is set on a run). After the status transition, classify via U1; if `system` or `unrouted`, INSERT inbox row guarded by `WHERE NOT EXISTS (SELECT 1 FROM inbox_items WHERE entity_type='agent_workspace_run' AND entity_id=run.id)`. Title: `"Workspace review: {agent.name} on {target_path}"` (or `"Workspace review (unrouted): ..."` for unrouted). Description: review reason or first ~120 chars of review body. Config: serialize `{ reviewObjectKey, proposedChanges, reviewBody, reviewEtag, reason, agentSlug, targetPath, classification: { kind, responsibleUserId } }`.
- **Status sync**: in the same processor, on terminal events for runs that have a linked inbox item, UPDATE the inbox item's status (approved/rejected/etc.), set `decided_by` / `decided_at` from the workspace event payload, and copy `review_notes` from the response markdown. Decided-by may be a system actor (when the run resolved itself) or an operator user id (when an operator approved via Inbox).
- **Bridge in inbox mutations**: each existing approve/reject/requestRevision mutation gets a new branch: if `item.type === 'workspace_review' && item.entity_type === 'agent_workspace_run'`, it imports and calls the existing workspace review action lib (`packages/api/src/lib/workspace-events/review-actions.ts`) against `item.entity_id`, then proceeds with the existing inbox status update. Tenant-isolation auth is already enforced by both layers; preserve `requireTenantMember` checks at the entry point.
- **Recursion guard**: when the workspace review mutation fires from the bridge, the resulting events (`review.responded`) re-enter the processor's status-sync path. Detect that the inbox item already has the new status (set by the bridge) and skip the redundant UPDATE — or use an `actor_type='inbox_bridge'` marker to short-circuit.
- **Payload renderer**: a `WorkspaceReviewPayloadRenderer` component reads `payload.reviewBody` (markdown render), `payload.proposedChanges` (badge list with diff preview), `payload.classification.kind` (warning marker if 'unrouted'), and `payload.targetPath` (chip). Falls back to "See full request" disclosure for the full payload like other inbox types.
- **Sidebar**: pure 5-line edit to `apps/admin/src/components/Sidebar.tsx`. Final order documented inline.
- **Backfill**: standalone script callable via `pnpm tsx packages/api/scripts/backfill-system-reviews-to-inbox.ts --tenant <id|all>`. SELECT awaiting_review runs, classify, INSERT inbox row for each system/unrouted that doesn't have one. Print summary `created=N skipped=M`. Idempotent.

**Patterns to follow:**
- `apps/admin/src/components/inbox/InboxItemPayload.tsx` — existing type-keyed renderer pattern (`typeLabel`, `typeIcon`, `InboxItemPayloadRenderer`).
- `packages/api/src/lib/workspace-events/review-actions.ts` — encapsulated action functions; bridge calls these directly to avoid duplicating auth + audit logic.
- `packages/api/src/graphql/resolvers/inbox/cancelInboxItem.mutation.ts` — existing inbox mutation shape; mirror it for the new branches.

**Test scenarios:**
- Happy path: A workspace run transitions to `awaiting_review` with a system agent. An `inbox_items` row is created with `type='workspace_review'`, `entity_type='agent_workspace_run'`, `entity_id=run.id`, `status='pending'`. *Covers AE3, R2.*
- Happy path: A paired-human review fires. NO inbox item is created. *Covers AE1.*
- Edge case: An `unrouted` review fires. Inbox item is created with the warning marker (title prefix "Workspace review (unrouted)").
- Idempotency: replaying the same `review.requested` event for the same run does NOT create a duplicate inbox item. *Covers R12.*
- Bridge: `approveInboxItem` on a `type='workspace_review'` item calls `acceptAgentWorkspaceReview(entity_id)` AND updates inbox status to `approved` + sets `decided_by`/`decided_at`. *Covers R11, R8.*
- Bridge: `rejectInboxItem` on a workspace_review item dispatches to `cancelAgentWorkspaceReview` AND status → `rejected`.
- Bridge: `requestRevisionInboxItem` with notes dispatches to `resumeAgentWorkspaceRun({ responseMarkdown: notes })` AND status → `revision_requested`. *Covers R11.*
- Bridge: For non-workspace-review inbox items (e.g., legacy `task_assigned`), the existing mutation behavior is unchanged (no workspace dispatch).
- Status sync: when `review.responded` fires from outside the bridge (e.g., manual S3 deletion or alternate path), the matching inbox item's status is updated.
- Recursion guard: a bridge-initiated `review.responded` event does NOT re-trigger the inbox status update (or it's a no-op).
- Tenant isolation: classification doesn't leak across tenants in materialization; bridge mutations enforce `requireTenantMember`.
- Payload renderer: `type='workspace_review'` items show review body markdown, proposed-changes preview, target-path chip; "See full request" toggles the raw payload.
- Sidebar: Automations renders in `workItems` at position 4 (after Inbox); does NOT appear in `manageItems`. *Covers R10.*

**Verification:**
- All new tests pass; full api test suite stays green; admin test suite stays green.
- Manual smoke in dev: trigger a system-agent review, confirm Inbox shows the new item with the right title + payload preview, click Approve, confirm the workspace run resolves AND the inbox item shows `approved`.
- Trigger a paired-human review; confirm Inbox does NOT gain an item.
- Backfill script: run against dev with at least one pre-existing pending system review; confirm it creates the inbox row exactly once.

---

- U5. **Remove `/workspace-reviews` route and sidebar entry**

**Goal:** Once U3 and U4 are deployed and verified to cover all currently pending reviews, delete the standalone admin page, the sidebar entry, and any unused supporting code. Add a redirect from `/workspace-reviews` to `/scheduled-jobs?tab=hitl` for muscle memory.

**Requirements:** R5.

**Dependencies:** U3, U4. Plus a cutover verification gate (manual/SQL — see Verification).

**Files:**
- Delete: `apps/admin/src/routes/_authed/_tenant/workspace-reviews/index.tsx`
- Delete: `apps/admin/src/routes/_authed/_tenant/workspace-reviews/` directory if empty after deletion
- Modify: `apps/admin/src/components/Sidebar.tsx` (remove Workspace Reviews from `workItems`, lines 211-215; the Automations entry was already moved into `workItems` in U4)
- Modify: `apps/admin/src/lib/workspace-review-state.ts` — keep if mobile or U4 components reuse it; otherwise delete. Verify before deleting.
- Modify: `apps/admin/src/lib/graphql-queries.ts` — drop unused queries left over from the standalone page (only the page-specific imports; do not drop `AgentWorkspaceReviewsQuery` since U4 uses it)
- Modify: `apps/admin/src/routeTree.gen.ts` — auto-regenerated; commit the regenerated file
- Optionally Add: redirect route at `/workspace-reviews` pointing to `/scheduled-jobs?tab=hitl` (TanStack Router supports this via a route that immediately navigates)

**Approach:**
- Run a pre-deletion verification SQL against dev:
  ```sql
  -- Every awaiting_review system/unrouted run must have a corresponding inbox item
  SELECT r.id AS run_id, r.tenant_id, r.agent_id
  FROM agent_workspace_runs r
  WHERE r.status = 'awaiting_review'
    AND NOT EXISTS (
      SELECT 1 FROM inbox_items i
      WHERE i.entity_type = 'agent_workspace_run'
        AND i.entity_id = r.id
    );
  -- Result must be empty for every run that classifies as system/unrouted.
  -- (Paired runs intentionally have no inbox row — they live on mobile.)
  ```
  Cross-reference each remaining row's classification (paired/system/unrouted). Paired rows are expected to be in the result set; system/unrouted rows must NOT be. If any system/unrouted row is missing an inbox item, run the U4 backfill script first, then re-run this check.
- Delete the route file and directory.
- Remove `Workspace Reviews` from Sidebar.tsx workItems array.
- Regenerate routeTree.gen.ts via the TanStack Router build step.
- Add a redirect (lean) — `/workspace-reviews` → `/inbox`. Most workspace reviews now land as inbox items, and the user's muscle memory benefits from the redirect.

**Patterns to follow:**
- TanStack Router redirect pattern — see existing route files for any prior redirects in the repo.

**Test scenarios:**
- Happy path: After deployment, navigating to `/workspace-reviews` redirects to `/inbox`. *Covers AE5.*
- Happy path: Sidebar Work group has exactly four items in order: Dashboard, Threads, Inbox, Automations. Workspace Reviews entry is gone. *Covers R5, R10.*
- Happy path: Sidebar Manage group does not contain Automations; final order is Analytics, Webhooks, People, (Billing if owner). *Covers R10.*
- Edge case: Route tree compiles without dangling references to the deleted route.
- Integration: Existing in-flight reviews (paired or system) surface on the new surfaces immediately after deployment, with no orphans.

**Verification:**
- Pre-deletion: cutover verification SQL run against dev returns zero hidden reviews.
- Build passes; routeTree.gen.ts regenerates cleanly.
- Sidebar manual smoke: Workspace Reviews entry gone; redirect works.
- Test: `pnpm --filter @thinkwork/admin test` passes.

---

- U6. **Documentation: workspace-orchestration concept update + Inbox HITL section + Automations admin doc**

**Goal:** Update the Astro docs site to reflect the new routing model. Replace references to a standalone Workspace Reviews page; add the system-HITL section to the Inbox doc; add a small Automations admin doc covering its IA position and existing functionality; fix the existing Routines→Automations naming drift in the sidebar config.

**Requirements:** R9.

**Dependencies:** U5 (so docs reflect the deployed state).

**Files:**
- Modify: `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx` — rewrite the "Human review flow" section to describe the routing model (mobile for paired humans; Inbox for system reviews); update the troubleshooting table entries that mention "Workspace Reviews."
- Modify: `docs/src/content/docs/applications/admin/inbox.mdx` — add a section explaining that Inbox is the home for system-agent HITL reviews, document the workspace_review type, the action mapping (Approve → accept; Reject → cancel; Request revision → resume with notes), and that materialization happens automatically when a system run pauses.
- Modify: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx` — add a paragraph clarifying that sub-agent reviews surface to the parent chain's paired human (currently doc'd flow only covers direct-agent reviews per `docs/plans/2026-04-26-005`).
- Create: `docs/src/content/docs/applications/admin/automations.mdx` — short doc covering Automations' purpose (recurring agent work / scheduled jobs) and noting that it now lives in the Work group below Inbox. No HITL content in this doc — that lives in `inbox.mdx`.
- Modify: `docs/astro.config.mjs` — rename the `Routines` sidebar label/slug to `Automations` (verify the actual slug; the admin app's UI label is Automations, so the doc must match). Move the Automations entry from the Manage subgroup to the Work subgroup of the admin sidebar (mirror the admin app's IA: Work = Dashboard, Threads, Inbox, Automations; Manage = Analytics, Webhooks, People, etc.). Add the new admin Automations doc entry.

**Approach:**
- Rewrite the Human Review Flow section to follow the routing tree from the High-Level Technical Design.
- Use the Mermaid-style diagram or table form already used in `workspace-orchestration.mdx`.
- Inbox doc gets a new "Workspace reviews (system HITL)" subsection: explains that system-agent HITL items appear here, lists the three actions and how they map to workspace review semantics, links to the orchestration concept doc.
- Automations doc mirrors structure of other admin docs (e.g., `threads.mdx`): brief overview, walkthrough of scheduled jobs, IA note that it sits in Work below Inbox.
- Cross-link the new doc and the Inbox HITL section from the orchestration concept doc's "Related pages" section.

**Patterns to follow:**
- `docs/src/content/docs/applications/admin/inbox.mdx` and `threads.mdx` — house style for admin app docs.
- `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx` (existing structure) — preserve heading order; targeted edits only.

**Test scenarios:**

Test expectation: none — docs are MDX, no behavior to test. Verification handled by content review and Astro build.

**Verification:**
- `pnpm --filter @thinkwork/docs build` (or whatever the docs build command is) succeeds with no broken links.
- Manual review: orchestration concept doc no longer references the standalone admin page; mobile doc explicitly covers sub-agent surfacing; Inbox doc covers the system-HITL section; new Automations admin doc matches the deployed UI.
- Astro sidebar (`docs/astro.config.mjs`) shows "Automations" not "Routines" under the Work subgroup and includes the new admin doc.

---

## System-Wide Impact

- **Interaction graph:** Resolver classification (U1+U2) is read by mobile (U3) and the workspace event processor (U4); the processor materializes system reviews as inbox items. Inbox mutations (`approveInboxItem`, `rejectInboxItem`, `requestRevisionInboxItem`) gain server-side bridges to the existing workspace review mutations (`acceptAgentWorkspaceReview`, `cancelAgentWorkspaceReview`, `resumeAgentWorkspaceRun`) — which themselves remain unchanged in contract. The Inbox sidebar badge naturally counts system reviews because they're inbox items.
- **Error propagation:** Classification helper logs structured warnings on cycle/depth-cap; resolver returns `kind='unrouted'` rather than failing the query. Materialization treats unrouted the same as system but marks the inbox row's title with a warning prefix so it's operationally visible. Bridge dispatch errors surface via the existing inbox mutation error path.
- **State lifecycle risks:** No schema change. Materialization adds a write-time hook in the workspace event processor — recursion guard required so bridge-dispatched `review.responded` events don't redundantly update the inbox row. Cutover risk: if U5 deploys before U4 + backfill confirm coverage, system reviews from before U4 could become invisible. Cutover gate (verification SQL + run backfill if needed) is the mitigation.
- **API surface parity:** GraphQL `AgentWorkspaceReview` gains two non-breaking fields (`responsibleUserId`, `kind`) and a new enum (`WorkspaceReviewKind`). Existing consumers continue to work without those fields. New query `pendingSystemReviewsCount` is additive. Mobile + admin + CLI consumers regenerate codegen.
- **Integration coverage:** End-to-end smoke in dev — trigger paired review (verify mobile only), trigger system-agent review (verify admin only), trigger sub-agent review (verify parent's mobile), confirm cross-user isolation between two test users in the same tenant.
- **Unchanged invariants:**
  - Review file format and S3 paths unchanged.
  - Workspace event types and dispatcher logic unchanged.
  - Run state machine (`awaiting_review` → `pending` → `processing` etc.) unchanged.
  - Mutation auth semantics (`requireTenantMember` + `requireTenantAdmin` for protected paths) unchanged.
  - Mobile in-thread approval card UI unchanged structurally; only the underlying filter changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Mobile users currently see other users' reviews; deploying U3 makes them disappear, which could be confusing if not communicated. | Ship U3 with a release note acknowledging the privacy fix; the change is correctness, not a regression. |
| Recursive CTE walks may surprise on large tenants or deep chains. | Depth cap 8 + `EXPLAIN` review during U1; existing `agents.depth` constraints keep real chains shallow. Add a perf test if needed. |
| Cutover ordering — deleting `/workspace-reviews` (U5) before U3 and U4 are verified would orphan reviews. | Hard gate: U5 only lands after the verification SQL (every system/unrouted run has an inbox item) returns clean in dev, with the U4 backfill script run if necessary. Document the gate in the U5 PR description. |
| `agents.human_pair_id` may be null on user-source agents in older tenants (pre-pairing). | Treat as `unrouted`; materialize as an inbox item with a warning-prefixed title so it's investigated. |
| Materialization recursion: bridge-dispatched workspace review mutations re-enter the processor and could double-update the inbox row. | Recursion guard (actor-type check or status-already-set short-circuit) in the processor's status-sync path. Tested explicitly. |
| Backfill script could double-insert if run twice. | Script INSERTs are guarded by `WHERE NOT EXISTS`; safe to re-run. |
| GraphQL enum addition (`WorkspaceReviewKind`) requires codegen across four consumers; missing one causes type drift. | U2 verification step explicitly runs codegen across `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` and commits the regenerated files. |
| Astro docs sidebar `Routines` label may be referenced elsewhere (cross-links, search index). | Grep the docs tree for `routines` references during U6; update or redirect as needed. |

---

## Documentation / Operational Notes

- Update the workspace-orchestration concept doc and the mobile Threads doc as part of U6 — both are user-facing and currently describe a two-surface model that doesn't match the new routing.
- New admin Automations doc gives this user-facing change documentation parity with every other admin page.
- No monitoring change required — the existing run/event tables and `mirror_status` column remain canonical.
- Release note: explicitly call out the cross-user isolation fix on mobile so users understand reviews disappearing from other users' devices is intentional.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md`
- Related plans:
  - `docs/plans/2026-04-26-001-feat-workspace-orchestration-hitl-review-plan.md` (foundation)
  - `docs/plans/2026-04-26-002-feat-workspace-review-detail-actions-plan.md` (detail UI shipping)
  - `docs/plans/2026-04-26-005-docs-mobile-hitl-process-plan.md` (mobile docs already in)
- Schema: `packages/database-pg/src/schema/agents.ts`, `packages/database-pg/src/schema/agent-workspace-events.ts`
- Resolvers: `packages/api/src/graphql/resolvers/workspace/`
- Admin sidebar: `apps/admin/src/components/Sidebar.tsx`
- Mobile HITL: `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/app/thread/[threadId]/index.tsx`
- Docs: `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx`, `docs/astro.config.mjs`
