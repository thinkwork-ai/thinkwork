---
title: "feat: Routines rebuild Phase D — UI"
type: feat
status: active
date: 2026-05-01
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Routines rebuild Phase D — UI

## Summary

Land the customer-facing surfaces. Restructure admin nav so Automations becomes a real parent section with Routines / Schedules / Webhooks children (replacing the current single "Automations" label that points at scheduled-jobs alone). Build the admin chat surface for operators inside the new section. Build the run-detail surface (Step Functions execution graph + agent-authored markdown summary + per-node panel sourced from `routine_step_events`) on both admin and mobile per R23. Build the run list with status filters and near-real-time updates. After Phase D, the customer-facing "agentic → robotic" demo is fully feasible.

---

## Problem Frame

Phase D of the master plan (`docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`). Phases A-C produce ASL routines that execute on Step Functions and can be triggered by users, agents, or schedules. Nothing in admin or mobile shows the run state, the per-step detail, or surfaces routines under a coherent Automations module — Routines isn't even in the admin sidebar today. Without Phase D's UI, customers can't see what's happening when a routine runs, and Eric can't demo the cornerstone messaging.

---

## Requirements

R-IDs trace to the origin requirements doc.

- R1, R2. Admin chat builder mirrors mobile (U13).
- R5. Visual ASL graph is read-only (U13's execution graph satisfies this).
- R14, R15, R16, R17. Run-detail and run-list surfaces (U13, U14).
- R22. Admin nav restructure: Automations parent + Routines + Schedules + Webhooks children (U12).
- R23. Mobile parity for the run-detail experience (U13).

**Origin actors:** A1 (end user, mobile), A2 (operator, admin).
**Origin flows:** F1 (end-user authoring — admin parity in Phase D), F2 (operator authoring), F4 (HITL execution — UI side).
**Origin acceptance examples:** AE1 (markdown summary names approval point), AE4 (run UI surfaces awaiting_approval), AE5 (cycle-detection error reaches UI).

---

## Scope Boundaries

- No legacy Python routine archival (Phase E U15).
- No `python()` usage dashboard (Phase E U16).
- No new step types or runtime changes (Phases A/B own those).
- Origin Scope Boundaries carried forward unchanged.

### Deferred to Follow-Up Work

- Phase A (Substrate) — `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` (must merge first)
- Phase B (Runtime) — `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` (must merge first)
- Phase C (Authoring) — `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md` (must merge first)
- Phase E (Cleanup + observability) — `docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md`

---

## Context & Research

Defer to the master plan's "Context & Research" section. Phase-D-specific highlights:

- `apps/admin/src/components/Sidebar.tsx` — flat `NavItem[]` today; introduce `SidebarMenuSub` shadcn primitive (already in package, not yet imported)
- `apps/admin/src/routes/_authed/_tenant/{routines,scheduled-jobs,webhooks}/` — current top-level routes; move under `/automations/`
- `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` — `OnThreadTurnUpdatedSubscription` precedent for near-real-time
- `apps/admin/src/components/threads/ExecutionTrace.tsx` — closest existing graph-render primitive; extend or reskin for the routine execution graph
- `apps/mobile/app/routines/[id]/` — existing per-routine route; gain run-detail entry
- `apps/admin/src/routes/_authed/_tenant/inbox/$inboxItemId.tsx` — for HITL deep-link target (run-detail awaiting_approval node links here)

---

## Key Technical Decisions

Carry from the master plan (Phase D-relevant subset):

- **Run UI sources execution data from Step Functions native APIs** (`GetExecutionHistory`, `DescribeExecution`) augmented with persisted `routine_step_events`.
- **`SidebarMenuSub` shadcn primitive** for parent/children nav structure (no custom collapsible component).
- **Old top-level routes (`/routines`, `/scheduled-jobs`, `/webhooks`) keep 301-redirect shims** so existing deep-links and operator muscle memory still land.
- **Mobile run-detail = vertical list with status icons** (simpler graph render than admin's full graph), same step panel, same markdown summary.
- **Real-time updates via existing AppSync subscription pattern** if it cleanly extends; otherwise polling.

---

## Open Questions

### Resolved During Planning

All Phase D open questions resolved in the master plan.

### Deferred to Implementation

- Subscription wiring exact shape — AppSync vs polling pinned to whichever pattern reuses cleanly from `OnThreadTurnUpdatedSubscription`.
- Whether to share components between admin run-detail and mobile run-detail — mobile probably re-implements graph render; step panel + markdown summary may share a `packages/ui-shared` module if one exists.
- HITL deep-link from run-detail awaiting_approval node — open in side-panel vs navigate to inbox detail.
- Empty state for routines list — placeholder copy + CTA decided during implementation.

---

## Implementation Units

Units carried verbatim from the master plan. U-IDs preserved.

- U12. **Admin nav restructure: /automations parent + Routines + Schedules + Webhooks**

**Goal:** Introduce `/automations` parent route, move `/scheduled-jobs` → `/automations/schedules` (with redirect), move `/webhooks` → `/automations/webhooks` (with redirect), move `/routines` → `/automations/routines` (with redirect), restructure sidebar with `SidebarMenuSub`.

**Requirements:** R22

**Dependencies:** None hard; ship after authoring is functional so users have something to find under Routines.

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/automations/index.tsx` (redirects to `/automations/routines`)
- Create: `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` (moved + reskinned from existing routines/index)
- Create: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` (admin chat surface — see U13)
- Move: `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/*` → `apps/admin/src/routes/_authed/_tenant/automations/schedules/*`
- Move: `apps/admin/src/routes/_authed/_tenant/webhooks/*` → `apps/admin/src/routes/_authed/_tenant/automations/webhooks/*`
- Create: `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` (301 redirect → `/automations/schedules`)
- Create: `apps/admin/src/routes/_authed/_tenant/webhooks/index.tsx` (301 redirect → `/automations/webhooks`)
- Create: `apps/admin/src/routes/_authed/_tenant/routines/index.tsx` (301 redirect → `/automations/routines`)
- Modify: `apps/admin/src/components/Sidebar.tsx` (introduce `SidebarMenuSub`; new "Automations" parent with Routines/Schedules/Webhooks children; remove standalone "Webhooks" entry from "Manage")

**Approach:**
- Use shadcn `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton` primitives.
- Redirects via TanStack Router `redirect()` in route loaders.
- Automations parent row has chevron + active scheduled-jobs badge (preserve current badge behavior). Clicking parent navigates to `/automations/routines` (default child).
- Verify all deep-linked URLs in docs/Slack continue to land via redirects.

**Patterns to follow:**
- shadcn-ui sidebar examples (`SidebarMenuSub` is documented in shadcn's sidebar component family)
- `apps/admin/src/components/Sidebar.tsx` (existing structure)

**Test scenarios:**
- Happy path: visiting `/scheduled-jobs` 301-redirects to `/automations/schedules`
- Happy path: visiting `/webhooks` 301-redirects to `/automations/webhooks`
- Happy path: visiting `/routines` 301-redirects to `/automations/routines`
- Happy path: clicking Automations in sidebar opens section, navigates to `/automations/routines`
- Edge case: user lands on `/automations` directly → redirected to `/automations/routines`
- Integration: existing breadcrumbs in scheduled-jobs/webhooks still render correctly under new path

**Verification:**
- Manual in dev admin: every old URL works; new URLs render correctly; sidebar reflects new shape
- `pnpm --filter @thinkwork/admin typecheck` passes
- `pnpm --filter @thinkwork/admin test` passes

---

- U13. **Run-detail surface: ASL graph + markdown summary + step panel (admin + mobile)**

**Goal:** Render a routine execution as the Step Functions execution graph (from `GetExecutionHistory`) plus the agent-authored markdown summary, plus a per-node panel showing input/output/duration/retries/cost. Cover admin AND mobile per R23. Includes the admin chat surface (sharing the mobile builder prompt) reachable from `/automations/routines/new`.

**Requirements:** R1, R2, R14, R15, R16, R23, AE4

**Dependencies:** U12 (admin nav), Phase B U7 (data exists), Phase B U9 (step events ingested)

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.executions.$executionId.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` (admin chat surface; reuses mobile prompt from Phase C U10)
- Create: `apps/admin/src/components/routines/ExecutionGraph.tsx`
- Create: `apps/admin/src/components/routines/StepDetailPanel.tsx`
- Create: `apps/admin/src/components/routines/MarkdownSummary.tsx`
- Create: `apps/admin/src/components/routines/RoutineChatBuilder.tsx` (admin chrome around the mobile prompt + tool-call flow)
- Create: `apps/mobile/app/routines/[id]/executions/[executionId].tsx`
- Create: `apps/mobile/components/routines/ExecutionGraphMobile.tsx`

**Approach:**
- `ExecutionGraph`: derive node positions from the parsed step manifest (from `routine_asl_versions.step_manifest_json`); overlay step status from `routine_step_events`. Extend `ExecutionTrace.tsx` or stand up a thin adapter.
- `StepDetailPanel`: shows on click; renders input/output JSON, recipe type, retry count, llm_cost_usd_cents, duration. For `python()` steps, includes "View full output" link to S3 (via a presigned-URL narrow REST endpoint — implement here or as a small Phase E follow-up).
- `MarkdownSummary`: renders `routine_asl_versions.markdown_summary`. HITL points are linkable (anchors scroll to corresponding graph node).
- `RoutineChatBuilder` (admin): same prompt as mobile (Phase C U10), same `publishRoutineVersion` mutation, same validator integration. Different chrome (admin sidebar + breadcrumbs).
- Mobile parity: simpler graph (vertical list with status icons), same step panel, same summary. Pull-to-refresh.
- Real-time updates via `OnRoutineExecutionUpdated` subscription (Phase A U3) or polling (decision pinned to `OnThreadTurnUpdatedSubscription` precedent).

**Patterns to follow:**
- `apps/admin/src/components/threads/ExecutionTrace.tsx`
- `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/$scheduledJobId.tsx`
- `apps/mobile/app/routines/builder.tsx` + Phase C U10's prompt for the admin chat builder

**Test scenarios:**
- Happy path: completed execution graph renders with all nodes + status; click reveals step panel
- Happy path: covers AE4 — in-progress execution with `inbox_approval` pending; awaiting node shows `awaiting_approval` state; deep links to inbox item
- Happy path: covers AE1 — markdown summary names approval point; HITL anchor scrolls graph to the right node
- Happy path: admin chat builder produces a routine end-to-end same as mobile
- Edge case: execution with zero step events (just-started) renders graph from manifest, all states `pending`
- Edge case: execution with `Map` over 100 items renders Map node with child-execution drilldown count
- Integration: mobile run-detail matches admin parity for the same execution

**Verification:**
- Manual: dev tenant routine execution renders correctly in both admin + mobile
- Admin chat builder produces equivalent ASL to mobile for the same prompt
- `pnpm --filter @thinkwork/admin typecheck` + mobile typecheck pass

---

- U14. **Run-list surface with status filters + near-real-time**

**Goal:** Per-routine run list (paginated, filterable, near-real-time) on the routine detail page.

**Requirements:** R17

**Dependencies:** U13 (run-detail destination)

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.tsx` (run list as default tab)
- Create: `apps/admin/src/components/routines/ExecutionList.tsx`
- Modify: `apps/mobile/app/routines/[id]/index.tsx` (mobile run list)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (`routineExecutions` query + `OnRoutineExecutionUpdated` subscription)

**Approach:**
- Run list shows: started_at, duration, status badge, trigger source, total_llm_cost (formatted). Click → run detail.
- Status filter pills: `all` / `running` / `succeeded` / `failed` / `awaiting_approval` / `cancelled` / `timed_out`. Stored in URL search params.
- Pagination cursor-based using `started_at`.
- Near-real-time: subscription if AppSync wires cleanly; otherwise polling at 5s while page visible.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` (`OnThreadTurnUpdatedSubscription`)

**Test scenarios:**
- Happy path: routine with multiple executions paginated correctly
- Happy path: covers AE4 — `awaiting_approval` filter surfaces only paused-for-HITL executions
- Edge case: routine with zero executions shows empty state with "Trigger now" link
- Integration: live execution updates row in real-time

**Verification:**
- Manual: dev routine list updates as executions complete

---

## System-Wide Impact

- **Interaction graph:** Admin nav restructure ripples to every operator; existing breadcrumbs and deep-links must continue working via 301 redirects. Run-detail surface adds a new consumer of `GetExecutionHistory` (rate-limited per tenant — fine at 4-tenant scale).
- **API surface parity:** Admin chat builder is the second consumer of the routine-builder prompt (mobile is the first); shared GraphQL mutation, same validator.
- **Unchanged invariants:** Existing scheduled-jobs and webhooks UIs render identically under their new paths.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 301 redirects miss a deep-linked URL in docs/Slack | Grep all repos for `/scheduled-jobs`, `/webhooks`, `/routines` URLs; verify each redirects |
| `SidebarMenuSub` import clashes with existing shadcn version | Verify package version compatibility; lock to known-good version |
| Mobile graph rendering performance on 100+ step executions | Cap displayed steps at 50 with "show more" pagination |
| Admin chat builder regresses against mobile prompt | Share the prompt module; lint that both surfaces import the same module |
| Subscription wiring drift breaks near-real-time on either surface | Reuse existing `OnThreadTurnUpdatedSubscription` pattern verbatim |
| Run-detail S3 presigned URL leaks across tenants | Sign URLs server-side with tenant-scoped IAM; expire in 5 min |

---

## Sources & References

- **Master design plan:** `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- **Origin requirements:** `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`
- **Predecessors:** Phase A, B, C plans (must merge first)
