---
title: Admin thread detail right-rail reshape + ThreadLifecycleBadge (U6)
type: feat
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Admin thread detail right-rail reshape + ThreadLifecycleBadge (U6)

## Overview

Reshape `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`'s `ThreadProperties` panel to the post-U3/U4 shape. Replaces the task-tracker Status/Priority/Type pickers with a derived `ThreadLifecycleBadge` (consuming `thread.lifecycleStatus` from U4), adds a Trigger row (derived from `thread.channel`), adds a compact turn + cost summary row, and wires the admin `ThreadDetailQuery` to the new GraphQL field. Carries forward the "Open in X-Ray" header link per U1's keep-path decision.

Extract from parent plan U6 (`docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` line 502). U3 + U4 are merged so the predecessor gating is satisfied.

---

## Problem Frame

U3 dropped `thread.priority` and `thread.type` from the GraphQL surface but the `$threadId.tsx` admin detail page still renders `<Select>` blocks for those fields. The Select components still read `thread.priority` and `thread.type` from codegen'd types that no longer exist — the page runs on a stale TypeScript snapshot and would fail at runtime the moment a thread detail loads. U6 closes that gap.

U3 also dropped `thread.status` as the operator-authored axis; U4 added `thread.lifecycleStatus` as the derived replacement. The detail page's Status `<Select>` is still the old axis — U6 swaps it for a `ThreadLifecycleBadge` read-only display.

Secondary: post-U3/U4 the right rail should show Trigger (derived from `channel`) and a turn + cost summary instead of the task-tracker Type row.

---

## Requirements Trace

- R1. `$threadId.tsx` imports no longer reference `PriorityIcon` / `TYPE_OPTIONS` / `PRIORITY_OPTIONS` / removed types.
- R2. `ThreadProperties` panel renders `ThreadLifecycleBadge` at the top (read-only, not a Select).
- R3. `ThreadProperties` Priority and Type `<Select>` blocks are removed.
- R4. `ThreadProperties` Status `<Select>` is removed (replaced by the lifecycle badge).
- R5. A Trigger row renders the human-readable label mapped from `thread.channel` (table in Approach). Unrecognized values render the raw string, not "Unknown".
- R6. A Turn + cost summary row renders, formatted like "3 turns · 1,444 tokens · $0.0118". Sourced from existing `thread.messages.edges` aggregate + `thread.costSummary`.
- R7. `ThreadLifecycleBadge` component wraps the existing `StatusBadge` styling with the `ThreadLifecycleStatus` enum and accepts an optional real-time override from `useActiveTurnsStore`.
- R8. On initial query load, the badge renders a skeleton placeholder (pulse animation, same dimensions as the final badge). On refresh, the previous value is held in place — no spinner flash.
- R9. `ThreadDetailQuery` in `apps/admin/src/lib/graphql-queries.ts` selects `lifecycleStatus` (keeps `channel`).
- R10. `ExecutionTrace.tsx` drops the `<Comment>` form and `comments` list rendering if still present (U3a/U3b merged; verify and clean residues).
- R11. Conditional: since U1 exited `0` (keep X-Ray path per session memory), preserve "Open in X-Ray" header link on the detail page.
- R12. Admin + mobile tsc error counts do not regress against `origin/main` baseline.

**Origin requirements carried forward:** R10 from parent plan (derived lifecycle status visible in right rail).

---

## Scope Boundaries

- Threads list view (`threads/index.tsx`) is U7 — out of scope here.
- Mobile parity (`apps/mobile/app/thread/[threadId]/info.tsx`) is U9 — out of scope here.
- CLI flag cleanup is U10 — out of scope.
- No new mutations. Badge is read-only; lifecycle is derived.
- No subscription publisher. Clients refresh via their existing cadence.
- No destructive DB work — U5 owns that.
- Attachments section stays (reserved for upcoming photos/files feature, per user direction). If the panel still renders an Attachments block post-U3, it stays — no action.
- `ExecutionTrace.tsx` scope is minimal: drop leftover `comments` prop + render path only if present. Do not refactor the file.

### Deferred to Follow-Up Work

- Mobile lifecycle badge + Trigger rows: U9 of the parent plan.
- Performance: `thread_turns (thread_id, created_at DESC)` composite index — noted in U4's residual; ship in a follow-up PR before U6's badge lights up across many list views at scale.

---

## Context & Research

### Relevant Code and Patterns

- **`apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`** — canonical site. `ThreadProperties` component lives inline (~line 660+). Current state has orphan Status/Priority/Type Selects (lines ~700–755) + `handlePriorityChange` / `handleTypeChange` handlers + `PriorityIcon` import at line 12 + stale passthrough at lines 628–629. All need dropping.
- **`apps/admin/src/components/StatusBadge.tsx`** — existing badge styling. `ThreadLifecycleBadge` wraps this pattern.
- **`apps/admin/src/components/threads/LiveRunWidget.tsx`** — existing live-turn-read pattern via `useActiveTurnsStore`. Mirror for the badge's real-time override.
- **`apps/admin/src/stores/active-turns-store.ts`** — `_activeThreadIds` set; the badge checks this to force `RUNNING` when the client knows about an active turn that may not have propagated to the resolver yet.
- **`apps/admin/src/lib/graphql-queries.ts`** — `ThreadDetailQuery` already has `channel` (kept through U3). Adds `lifecycleStatus` to the selection set.

### Institutional Learnings

- **`feedback_communication_style`** — lead with a recommendation; don't over-narrate.
- **U4's residual findings** — composite index for `thread_turns(thread_id, created_at DESC)` is not yet shipped. The lifecycle badge will trigger two SQL probes per thread detail view; at the ~1 request/view cadence this is fine, but flag if list-view adoption lands before the index does.
- **Admin worktree Cognito callbacks** (from prior memory) — if the user wants to manually test on a dev server from this worktree, the Vite port 5175+ needs to be registered in the ThinkworkAdmin Cognito CallbackURLs.

### External References

None — entirely local UI work.

---

## Key Technical Decisions

- **Badge is read-only**, not a Select. Lifecycle is derived from `thread_turns`; there's nothing for an operator to "set" — action is on the agent, not on the operator.
- **Skeleton on first load, hold-previous on refresh.** Mirrors the pattern documented in U4's skeleton/hold-previous spec. Prevents flash during polling.
- **Trigger label map is inline in the component, not a shared util.** Only one consumer (the Trigger row); shared util would be premature abstraction per the project standards. Mobile's U9 will copy the same map, and if a third consumer appears we hoist.
- **Turn + cost summary sourced from existing data.** `thread.messages.edges.length` for turn count, `thread.costSummary` for cost, aggregate `message.tokenCount` or similar for tokens. The Activity header in the page already computes one or more of these — reuse that data if accessible without a second fetch.
- **`ThreadLifecycleBadge` lives in `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx`.** Not a shared primitive in `components/ui/` — it's specific to thread lifecycle semantics.
- **No sub-components for Trigger row or Turn summary.** One component each, inline in `ThreadProperties`. Split only if rendering gets complex enough to warrant it.

---

## Open Questions

### Resolved During Planning

- **Does the Status Select need to be swapped for a badge, or dropped entirely?** Swap. The lifecycle badge replaces it visually.
- **Does the existing `thread.status` write path still fire from `handleStatusChange`?** U3 dropped `thread.status` input from `UpdateThreadInput`. Any admin code still calling `updateThread({ status })` is already dead — but let me verify execution-time that the `handleStatusChange` branch is an orphan and can be deleted.
- **What does `thread.costSummary` shape look like?** Derived from existing `ThreadDetailQuery` — already selected. Verify shape during execution.

### Deferred to Implementation

- **Exact skeleton pill dimensions.** Match `StatusBadge`'s rendered height/width.
- **ExecutionTrace cleanup scope.** If `comments` prop is still on `ExecutionTraceProps`, drop it. If it's already gone (U3b autofix caught it), skip. Execution-time check.
- **Activity feed summary calculation.** If the existing Activity header already computes turns/tokens/cost, reuse. Otherwise compute inline.

---

## Implementation Units

- U1. **Create `ThreadLifecycleBadge` component**

**Goal:** New component at `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx`. Props: `lifecycleStatus: ThreadLifecycleStatus | null`, `threadId: string` (for active-turns-store lookup), `loading?: boolean`. Renders:
  - Skeleton pulse pill when `loading=true` and no prior value
  - Badge matching StatusBadge visual vocabulary for each of the 5 emittable states (RUNNING / COMPLETED / CANCELLED / FAILED / IDLE)
  - `AWAITING_USER` is reserved — render as `IDLE` styling if it ever arrives (unreachable in v1 but defensive)
  - When `useActiveTurnsStore._activeThreadIds.has(threadId)` is true, force `RUNNING` regardless of the prop (real-time override)

**Requirements:** R2, R7, R8.

**Dependencies:** None.

**Files:**
- Create: `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx`

**Approach:**
- Import `useActiveTurnsStore` from `@/stores/active-turns-store`.
- Colors/styles: match `StatusBadge`'s existing visual vocabulary — green for COMPLETED, red for FAILED, blue/pulsing for RUNNING, gray for IDLE, yellow for CANCELLED.
- Hold-previous semantics: parent component manages the previous-value ref; the component itself is a pure view.

**Patterns to follow:**
- `apps/admin/src/components/StatusBadge.tsx` for visual vocabulary.
- `apps/admin/src/components/threads/LiveRunWidget.tsx` for store access pattern.

**Test scenarios:** — none (no admin test harness). Covered by U3 smoke.

**Verification:**
- Component typechecks clean.
- Renders each of the 5 emittable states with visually-distinct styling.

---

- U2. **Rewire `ThreadProperties` in `$threadId.tsx`**

**Goal:** Drop Status/Priority/Type `<Select>` blocks + associated handlers/imports. Insert `ThreadLifecycleBadge` at the top. Add Trigger row + Turn+cost summary row. Keep Agent/Created/Last-turn rows. Drop stale passthrough at lines 628–629. Drop `PriorityIcon` import.

**Requirements:** R1, R2, R3, R4, R5, R6, R11, R12.

**Dependencies:** U1.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`

**Approach:**
- Drop all `<Select>` blocks for Status/Priority/Type + their handlers (`handleStatusChange`, `handlePriorityChange`, `handleTypeChange`) + `PRIORITY_OPTIONS` / `TYPE_OPTIONS` / `STATUS_OPTIONS` constants if now unused.
- Drop `PriorityIcon` import.
- Drop `priority: thread.priority.toLowerCase()` and `type: thread.type.toLowerCase()` passthrough in ThreadFormDialog initial props.
- Insert `<ThreadLifecycleBadge lifecycleStatus={thread.lifecycleStatus} threadId={thread.id} loading={result.fetching && !thread.lifecycleStatus} />` at the top of `ThreadProperties`.
- Add Trigger `PropRow`:

  | `thread.channel` | Label |
  |---|---|
  | `chat`, `manual` | Manual chat |
  | `schedule` | Schedule |
  | `webhook` | Webhook |
  | `api` | Automation |
  | `email` | Email |
  | `null` | `—` (em dash) |
  | anything else | raw value (not "Unknown") |

- Add Turn + cost summary `PropRow`: compose "N turns · T tokens · $X.XXXX" from existing thread fields.
- Keep the "Open in X-Ray" header link (U1 keep-path per session memory `project_v1_agent_architecture_progress` — U1 exited 0).

**Execution note:** Verify line numbers from the plan are still accurate — U3d autofix may have shifted them. Re-grep for each target before editing.

**Patterns to follow:**
- Existing `PropRow label=... > ...` pattern in `ThreadProperties`.
- `LiveRunWidget` for any additional real-time UI hooks needed.

**Test scenarios:** — none automated. Covered by U3 manual smoke.

**Verification:**
- `pnpm --filter @thinkwork/admin build` succeeds.
- `cd apps/admin && npx tsc --noEmit` count does not exceed the 30-error baseline.
- Manual visual check: badge + trigger + turn/cost rows render, no orphan imports, no console errors.

---

- U3. **Wire `ThreadDetailQuery` lifecycleStatus selection + manual smoke**

**Goal:** `ThreadDetailQuery` selects `lifecycleStatus`; codegen regenerated; manual smoke of the reshaped panel.

**Requirements:** R9, R12.

**Dependencies:** U2.

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` (add `lifecycleStatus` to `ThreadDetailQuery` selection set; verify `channel` is present).
- Regenerate: `apps/admin/src/gql/*.ts` via `pnpm --filter @thinkwork/admin codegen`.
- Modify (conditional): `apps/admin/src/components/threads/ExecutionTrace.tsx` — if a leftover `comments` prop is still on `ExecutionTraceProps`, drop it. Grep check at execution time.

**Approach:**
- Inspect `ExecutionTrace.tsx` current state — U3b autofix should have removed the comments path but reviewer findings suggest residue may remain.
- Manual smoke on dev server at port 5175+: load threads in each lifecycle state (IDLE, RUNNING via fresh queued/running turn, COMPLETED, FAILED, CANCELLED), verify badge matches and the Trigger + turn/cost rows render.

**Patterns to follow:** existing `ThreadDetailQuery` — add field alongside status/channel.

**Test scenarios:** — none automated. Manual:
- Happy path: load a thread with recent succeeded turn → COMPLETED badge.
- Happy path: load a thread with fresh queued turn → RUNNING badge (may need to seed a fixture).
- Edge case: thread with zero turns → IDLE badge.
- Edge case: thread with null channel (shouldn't happen) → "—" trigger.
- Edge case: thread with `channel='unknown_string'` → raw string trigger.

**Verification:**
- Codegen shows `lifecycleStatus: ThreadLifecycleStatus | null` on the `thread(id)` result type.
- Admin build succeeds; dev server renders the new right rail without console errors.

---

## System-Wide Impact

- **Interaction graph:** The badge consumes `ctx.loaders.threadLifecycleStatus` via the GraphQL resolver added in U4. No new loader, no new mutation.
- **Error propagation:** If the loader fails and returns null (per U4's nullable field), the badge's skeleton/last-value logic should render a neutral state — not crash. Handled by the `loading` prop + null-safe rendering.
- **State lifecycle risks:** None — pure read path.
- **API surface parity:** Mobile detail page (U9) and threads list view (U7) will adopt the same badge/trigger pattern. Out of scope here; landed independently.
- **Integration coverage:** Covered by U3's manual smoke. No admin test harness exists.
- **Unchanged invariants:** `ThreadProperties` still renders Agent, Labels, Assignee, Due date, Created, Updated rows. Only Status/Priority/Type are swapped out, and the new Lifecycle/Trigger/Turn-cost rows come in.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Admin tsc baseline regression from leftover references | Pre-commit check: `cd apps/admin && npx tsc --noEmit` must not exceed 30 errors |
| Badge flickers during polling refresh | Hold-previous semantics in `ThreadProperties` (previousRef) + skeleton only on first-load |
| `channel` contains an unexpected string (data leak from webhook ingestion) | Raw-render as-is so ops sees the surprise instead of "Unknown" hiding it |
| X-Ray header link drift (should be present per U1 keep-path) | Verify current `$threadId.tsx` still has the link; restore if missing |
| `thread.status` orphan reads somewhere else (activity log line 154) | Activity log uses `thread_turns` kind events now; verify line 154 path isn't on the hot render path or can be migrated to `lifecycleStatus` |

---

## Documentation / Operational Notes

- PR body notes the reshape pairs with U4's lifecycle resolver and is a prerequisite for U9's mobile sweep.
- No env, terraform, or deploy changes.
- Once merged, a fresh admin deploy is required to see the new right rail — user's stale-bundle incident from the U3d rollout applies here too. Expect the same deploy-window stale-client cleanup.

---

## Sources & References

- **Parent plan:** [docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md](./2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md) (U6 section)
- **Predecessor PRs:** #539 (U3d/U3e), #545 (process-materializer fix), #546 (U4 lifecycleStatus resolver)
- **Memory:** `project_v1_agent_architecture_progress` (U1 keep-path decision), `feedback_communication_style`
