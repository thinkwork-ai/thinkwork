---
title: Mobile — retire status pickers, add lifecycle badge + channel (U9)
type: refactor
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Mobile — retire status pickers, add lifecycle badge + channel (U9)

## Overview

Carves U9 out of the pre-launch thread-detail cleanup plan (`docs/plans/2026-04-24-002-*`, lines 595–632) into a standalone slice. U3d retired the writable `status`/`priority`/`type` axes at the schema level; U4 shipped the derived `lifecycleStatus`; admin (U7, #551) and admin thread-detail (U6, #549) dropped the task-era surface; CLI (U10, #554) followed. This slice does the same for mobile.

**A fresh survey diverges from the parent plan text in three important ways:**

1. **`thread.priority` / `thread.type` / `thread.children` / `thread.parent` / `thread.comments` have zero hits in `apps/mobile/`.** They were already retired server-side; mobile never referenced them. No-op.
2. **`message.durableArtifact` is NOT retired** — parent plan assumed it was dropped in U3d, but the schema still exposes `durableArtifact: Artifact` on `Message` and mobile still renders it (`ChatBubble`, `ActivityTimeline`, `useGatewayChat`, `useGraphQLChat`). Out of scope.
3. **Mobile has two thread-detail routes, not one.** The parent plan only named `/thread/[threadId]/info.tsx` and `/threads/[id]/index.tsx`; both exist with independent status-picker implementations.

**The real U9 scope:**
- Retire the full status-picker UI in `/thread/[threadId]/info.tsx` (a measured-anchor dropdown with `executeUpdateThread({ status })` mutation).
- Retire the status-picker UI in `/threads/[id]/index.tsx` (inline list modal with `handleStatusChange` + `STATUS_LABELS` / `STATUS_ORDER` constants).
- Replace status display in `/threads/index.tsx` (list row) and `components/home/ActiveWorkSection.tsx` (home card) with a read-only lifecycle badge.
- Surface the `lifecycleStatus` field in `ThreadsQuery` + `ThreadQuery`, and drop the now-unused `$status: ThreadStatus` variable from `ThreadsQuery` (admin/CLI already stopped sending this arg).
- Handle the "Mark Done" button on `/thread/[threadId]/index.tsx:236-243` explicitly — see Decision 4 below.
- Regenerate codegen.

---

## Problem Frame

Two mobile detail pages expose interactive status pickers with seven legacy state names (BACKLOG / TODO / IN_PROGRESS / IN_REVIEW / BLOCKED / DONE / CANCELLED). Both mutate via `updateThread(input: { status })`. With admin and CLI having retired the surface and U4 shipping the derived lifecycle, mobile is the last client-side holdout exposing the retired axis.

Product direction (confirmed by U6 and U7's admin work):
- Lifecycle is **derived** from `thread_turns` via `thread.lifecycleStatus`.
- Manual `ThreadStatus` mutation stays server-reachable via `updateThread(input: { status })` and the Strands `update_thread_status` skill — but no interactive client UI should surface it in v1.
- Admin U6 kept `StatusIcon` click-to-update in the *list* row but dropped the properties-panel Status select; admin U7 further dropped the list-view status filter/sort/group.

Mobile's current surface is closer to the retired pattern than admin's current surface, so the cleanup has more to do.

---

## Requirements Trace

- R1. Both mobile thread-detail routes stop rendering interactive status pickers: no "change status" dropdown / modal / tap affordance.
- R2. Both mobile thread-detail routes render a read-only lifecycle badge derived from `thread.lifecycleStatus`.
- R3. The mobile threads list (`/threads/index.tsx`) and home card (`components/home/ActiveWorkSection.tsx`) replace `{thread.status}` display with lifecycle-badge display.
- R4. `ThreadQuery` selects `lifecycleStatus`; `ThreadsQuery` selects `lifecycleStatus` and drops the `$status: ThreadStatus` input argument.
- R5. No client-side call site remains that invokes `updateThread(input: { status })` with a user-chosen value. (The "Mark Done" button is retired per Decision 4.)
- R6. Zero greps across `apps/mobile/` for `STATUS_LABELS`, `STATUS_ORDER`, `handleStatusChange`, `statusDropdownVisible`, `statusSaving`, `serverStatus`, `statusVariant(thread`, `setShowStatusPicker`, `openStatusDropdown`.
- R7. `pnpm --filter mobile typecheck` passes; `pnpm --filter mobile test` (if defined) passes.
- R8. Codegen regenerated via `pnpm --filter mobile codegen`.

**Origin trace:** parent plan R13 (retire task-era thread axes from all client surfaces). Mobile is the third client after admin and CLI.

---

## Scope Boundaries

- **Out of scope — removing `thread.status` from the GraphQL Thread type.** Server-side field remains. Other callers (Strands skills, direct GraphQL) still read/write status.
- **Out of scope — `message.durableArtifact` / `message.artifacts`.** Parent plan assumed these were dropped in U3d; they weren't. `Artifact` and `MessageArtifact` types still live in the schema and mobile still renders them. Out of scope for this slice.
- **Out of scope — `thread.priority` / `thread.type` / `thread.children` / `thread.parent` / `thread.comments`.** Zero hits in `apps/mobile/` after a fresh scan. No-op.
- **Out of scope — the `/thread/[threadId]/` vs `/threads/[id]/` route duplication.** Two routes with overlapping responsibilities is technical debt worth reckoning with, but this slice does not consolidate them. It brings both to parity with the v1 lifecycle model.
- **Out of scope — adding a `<ThreadLifecycleBadge>` *component* to mobile.** React Native's NativeWind styling differs from admin's Tailwind surface; a shared component would be cross-package coupling. This slice renders the badge inline in each call site (5 call sites) with a small local helper. If a `components/threads/LifecycleBadge.tsx` gets extracted in a follow-up, good, but not required here.
- **Out of scope — iOS simulator build verification.** `pnpm --filter mobile build` (EAS build) has a dedicated CI workflow and isn't part of the standard 4-check PR gate. Manual smoke on a TestFlight dev build is the plan's stated verification path.
- **Out of scope — mobile thread-list status *filter*.** The `$status: ThreadStatus` variable on `ThreadsQuery` is dropped (R4), but the UI never had a status filter control to begin with (confirmed by grep).

---

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/lib/graphql-queries.ts:689-733` — `ThreadsQuery` declares `$status: ThreadStatus` input (unused by mobile UI after the filter retirement); also selects `status` on each returned thread.
- `apps/mobile/lib/graphql-queries.ts:735-783` — `ThreadQuery` selects `status`, `channel`, and a deep `messages.edges.node.durableArtifact` tree. No `lifecycleStatus` selected today.
- `apps/mobile/app/thread/[threadId]/info.tsx:114-236` — the most involved status surface. Declares `statusColor`, `serverStatus`, `statusDropdownVisible`, `statusAnchor`, `statusTriggerRef`, `statusSaving`, `openStatusDropdown`, calls `executeUpdateThread({ id, input: { status } })`, renders a measured-anchor Modal with all seven legacy states. ~120 lines to remove.
- `apps/mobile/app/threads/[id]/index.tsx:121-219` — inline status picker. Declares `showStatusPicker`, `STATUS_LABELS`, `STATUS_ORDER` constants, `handleStatusChange`. ~60 lines to remove.
- `apps/mobile/app/threads/index.tsx:89` — list row displays `{thread.status}` via `Muted` text.
- `apps/mobile/components/home/ActiveWorkSection.tsx:90-93` — home card displays `{thread.status}` in a `Badge` with `statusVariant(thread.status)` styling helper.
- `apps/mobile/app/thread/[threadId]/index.tsx:236-243` — a one-tap "Mark Done" button that calls `executeUpdateThread({ input: { status: "DONE" } })` when `!isDone`. See Decision 4.
- Admin reference pattern: `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx` (merged in U6) — shape of the lifecycle mapping and active-turn override logic. Mobile does not import this component (NativeWind ≠ Tailwind), but the mapping table is the reference for mobile's inline rendering.

### Institutional Learnings

- `feedback_worktree_tsbuildinfo_bootstrap` — fresh worktree requires the clean-and-rebuild step before `pnpm --filter mobile typecheck`.
- `feedback_ci_lacks_uv` — CI lacks `uv`; irrelevant here (pure TypeScript).
- `feedback_worktree_isolation` / `feedback_pr_target_main` / `feedback_merge_prs_as_ci_passes` — standard pre-launch workflow.
- `project_mobile_testflight_setup` — mobile deploys via TestFlight; iOS build verification is a separate pipeline, not part of the 4-check gate.
- `project_mobile_cognito_sync_invariant` — unrelated to this slice; mentioned here so the agent does not regress it inadvertently when touching mobile code.
- `project_mobile_auth_google_oauth` — unrelated; mentioned for the same reason.

### External References

None — localized mobile UI cleanup; no new library or API.

---

## Key Technical Decisions

- **Decision 1: Render the lifecycle badge inline in each of the 5 call sites, not as a shared component.** Cross-package component extraction (`components/threads/LifecycleBadge.tsx`) is justified only if the mapping + active-turn override logic grows. Current scope is a 6-entry lookup table plus a NativeWind classname string per state. Duplicating six lines across 5 files is less coupling debt than introducing a new shared component with cross-cutting imports. If the mapping needs to change later, 5 small updates are fine.
- **Decision 2: Drop `$status: ThreadStatus` input arg from `ThreadsQuery`** since the mobile UI never exposed a status filter. Keep `$channel: ThreadChannel` (channel filter is on the roadmap and mobile already wires it). Server-side `threads(status:)` stays — other callers (Strands skills, direct GraphQL) unaffected.
- **Decision 3: Keep `thread.status` selected in `ThreadQuery` / `ThreadsQuery` for now.** Removing the selection breaks mobile's current status-display render during any transition window where the new badge isn't fully wired. The display code is what gets replaced; the query selection can stay until `ThreadStatus` itself is retired server-side (far-future, out of scope).
- **Decision 4: Retire the "Mark Done" button on `/thread/[threadId]/index.tsx:236-243`.** Rationale: the button is the only surviving user-facing status-mutation affordance on this route. With status picker retired (R1) and `isDone = thread.status === "DONE"` scaffolded against a retired product axis, leaving a single button as a vestigial one-tap mutation is incoherent. Operators who need to close a thread programmatically can use the Strands `update_thread_status` skill; the "Done" concept in the derived-lifecycle model is `COMPLETED` and is server-determined, not user-chosen. If a user-driven "close this thread" button is a product requirement, scope it against real signals post-v1 as a thread-level `archivedAt` action rather than a status mutation.
- **Decision 5: No interactive lifecycle "picker" replacement.** The admin did not add one either; the badge is read-only.
- **Decision 6: Regenerate codegen even when the schema didn't change.** Mobile's `apps/mobile/lib/gql/*` may be stale relative to current origin/main — regen is cheap insurance. If the diff is empty, skip the commit hunk. If it shows any drift, that's surfaced and committed alongside this slice.

---

## Open Questions

### Resolved During Planning

- **Q:** Is `message.durableArtifact` retired? **A:** No — schema still exposes it (`messages.graphql:24`) and mobile still uses it in 4 places. Out of scope.
- **Q:** Are `thread.priority`/`thread.type`/`thread.children`/`thread.parent`/`thread.comments` referenced in mobile? **A:** No — zero hits. No-op.
- **Q:** How many routes expose a status picker? **A:** Two (`/thread/[threadId]/info.tsx` and `/threads/[id]/index.tsx`), each with a distinct implementation.
- **Q:** What happens to the "Mark Done" button? **A:** Retired (Decision 4).
- **Q:** Should the badge be a shared component? **A:** No (Decision 1).
- **Q:** Does the mobile list view have a status *filter* to retire? **A:** No — only a display (Decision 2's arg removal cleans up the query, nothing else).

### Deferred to Implementation

- **Exact NativeWind color classes for each lifecycle state.** Use the admin `ThreadLifecycleBadge` mapping as the reference but translate to the nearest NativeWind equivalent; implementation picks the exact class strings.
- **Whether the retired "Mark Done" button becomes a new "Archive" button in a follow-up PR.** Out of scope for this slice; product decision.
- **Whether the lifecycle-badge render should briefly inherit active-turn override** (force `RUNNING` when the `active-turns-store` says so). Mobile has no equivalent store today (confirmed by grep for `active-turns`). Ship without the override; if/when mobile gains a real-time turn tracker, add it then.

---

## Implementation Units

- U1. **GraphQL query edits + codegen regen**

**Goal:** `ThreadQuery` selects `lifecycleStatus`; `ThreadsQuery` selects `lifecycleStatus` and drops the `$status: ThreadStatus` input argument. Codegen regenerated. No downstream breakage until U2/U3 land.

**Requirements:** R4, R8.

**Dependencies:** None beyond `origin/main`.

**Files:**
- Modify: `apps/mobile/lib/graphql-queries.ts` — edit `ThreadsQuery` (line 689) and `ThreadQuery` (line 735).
- Modify: `apps/mobile/lib/gql/gql.ts`, `apps/mobile/lib/gql/graphql.ts` — regen outputs.
- Test: none — `apps/mobile` test harness not involved.

**Approach:**
- `ThreadsQuery`: remove `$status: ThreadStatus` from variable declarations and `status: $status` from the `threads(...)` args block. Keep `$channel`, `$agentId`, `$assigneeId`, `$limit`, `$cursor`. Keep the `status` field selection on the return shape.
- `ThreadQuery`: add `lifecycleStatus` to the return shape alongside `status` and `channel`.
- `ThreadsQuery`: add `lifecycleStatus` to the return shape alongside `status`.
- Run `pnpm --filter mobile codegen`; verify diff is bounded to these two operations.

**Execution note:** Mechanical. No test-first needed.

**Verification:**
- `rg '\$status: ThreadStatus' apps/mobile/lib/graphql-queries.ts` returns zero hits.
- `rg 'lifecycleStatus' apps/mobile/lib/graphql-queries.ts` returns exactly two hits (inside `ThreadQuery` and `ThreadsQuery`).
- Codegen output contains `lifecycleStatus?: ThreadLifecycleStatus | null` on the mobile `ThreadQueryResult` and `ThreadsQuery` items type.

---

- U2. **Retire status pickers on both thread-detail routes**

**Goal:** Neither `/thread/[threadId]/info.tsx` nor `/threads/[id]/index.tsx` renders an interactive status picker. Both display a read-only lifecycle badge + channel ("Trigger") row in the properties/summary section.

**Requirements:** R1, R2, R5, R6.

**Dependencies:** U1 (needs `lifecycleStatus` on the query output).

**Files:**
- Modify: `apps/mobile/app/thread/[threadId]/info.tsx` — remove `statusColor` helper, `serverStatus` / `statusDropdownVisible` / `statusAnchor` / `statusTriggerRef` / `statusSaving` state, `openStatusDropdown` helper, the anchored Modal with seven status options, and any `executeUpdateThread({ status })` call. Replace the properties-row "Status" field with a read-only lifecycle badge. Add a "Trigger" row showing `thread.channel` (using the same TRIGGER_LABELS mapping the admin U6 PR uses — copy the map or inline it; mobile has no shared location for it today).
- Modify: `apps/mobile/app/threads/[id]/index.tsx` — remove `showStatusPicker` state, `STATUS_LABELS` / `STATUS_ORDER` constants, `handleStatusChange`, and the inline picker modal. Replace the "Status" `InfoRow` with a read-only lifecycle badge. Add a "Trigger" `InfoRow` for `thread.channel`.
- Modify: `apps/mobile/app/thread/[threadId]/index.tsx` — remove the `isDone` check at line 236 and the "Mark Done" button. If `executeUpdateThread` becomes unused after this removal, delete its import/binding; otherwise leave.
- Test: none.

**Approach:**
- **Lifecycle badge helper.** Either inline the 6-state color mapping at each call site (per Decision 1) or extract a small helper within the same file. Either is acceptable. The states are `RUNNING` (blue, animated dot if possible via NativeWind), `COMPLETED` (green), `CANCELLED` (yellow), `FAILED` (red), `IDLE` (gray), `AWAITING_USER` (gray but labeled "Awaiting user"). Null lifecycleStatus renders nothing (server loader error signal; match admin U6's fallback).
- **Trigger row mapping.** `chat` / `manual` → "Manual chat"; `schedule` → "Schedule"; `webhook` → "Webhook"; `api` → "Automation"; `email` → "Email"; unknown → raw string (per admin U6). Null → "—".
- **Remove dead code.** After the picker code is gone, grep for unused imports (`Modal`, `Dimensions`, `Pressable` if only used in the picker, `measureInWindow` patterns, etc.) and clean up.
- **Preserve all non-status logic.** Both detail pages have lots of other behavior — artifact rendering, message timeline, reporter info, etc. Only the status-picker blocks and the Mark Done button are in scope.

**Patterns to follow:**
- Admin reference: `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx` for the state→color mapping; `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` for the Trigger row shape.
- Mobile's own `InfoRow` / `PropertyRow` component in each file — reuse, don't invent.

**Test scenarios:** all manual smoke on a TestFlight dev build after merge.
- *Happy path.* Open a thread with `lifecycleStatus === "RUNNING"` in `/thread/[threadId]/info.tsx`; badge renders "Running" with the animated-pulse dot if reachable via NativeWind.
- *Happy path.* Same in `/threads/[id]/index.tsx`.
- *Edge case — null lifecycleStatus.* Verify no badge renders (or a muted "—" — pick and match admin behavior).
- *Edge case — unknown channel.* With `channel === "task"` (or anything not in the map), verify the Trigger row renders the raw string.
- *Regression.* Tap the former picker area → nothing happens (it's read-only). Other detail-page actions (sending a message, opening an artifact) still work.

**Verification:**
- `rg 'STATUS_LABELS|STATUS_ORDER|handleStatusChange|statusDropdownVisible|statusSaving|serverStatus|openStatusDropdown|setShowStatusPicker' apps/mobile/` returns zero hits.
- `rg 'executeUpdateThread\(.*status' apps/mobile/` returns zero hits (no client-side status mutation call survives).
- `pnpm --filter mobile typecheck` passes; same or fewer errors than origin/main baseline.

---

- U3. **Replace status display in list + home card**

**Goal:** `apps/mobile/app/threads/index.tsx` and `apps/mobile/components/home/ActiveWorkSection.tsx` show lifecycle badges instead of raw `thread.status` text.

**Requirements:** R3, R6.

**Dependencies:** U1 (needs `lifecycleStatus` on the query output).

**Files:**
- Modify: `apps/mobile/app/threads/index.tsx` — replace line 89's `{thread.status}` with a lifecycle badge.
- Modify: `apps/mobile/components/home/ActiveWorkSection.tsx` — replace line 92-93's `Badge variant={statusVariant(thread.status)}>{thread.status}` with a lifecycle badge. Delete the `statusVariant` helper if it becomes dead after this edit.

**Approach:**
- Use the same lifecycle-badge mapping pattern established in U2 (inline per Decision 1).
- `statusVariant` may be used elsewhere in `apps/mobile/`; grep before deleting.
- Null `lifecycleStatus` → render nothing or `—` (match U2's choice).

**Test scenarios:** manual smoke.
- *Happy path.* Threads list shows lifecycle badges on each row.
- *Happy path.* Home "Active Work" card shows lifecycle badges.
- *Regression.* Other row metadata (title, identifier, agent name, timestamps) still render correctly.

**Verification:**
- `rg '\{thread\.status\}|statusVariant\(thread' apps/mobile/` returns zero hits.
- `pnpm --filter mobile typecheck` passes.

---

## System-Wide Impact

- **Interaction graph:** `executeUpdateThread({ input: { status } })` disappears from client-side call sites. Server-side `updateThread` mutation is untouched; Strands `update_thread_status` skill and direct GraphQL callers still work.
- **Error propagation:** Status-mutation failure paths (`Alert.alert("Error", "Failed to update status.")`) are removed alongside the picker. No new error surface introduced.
- **State lifecycle risks:** None. All edits are read-side display changes plus dead-code removal.
- **API surface parity:** Admin U6 / U7 / U8 shipped the same direction; CLI U10 shipped. Mobile after this slice matches admin's properties-panel shape. The two-route duplication (`/thread/[threadId]/` vs `/threads/[id]/`) is pre-existing and not resolved here.
- **Integration coverage:** None — no cross-layer behavior changes. Manual smoke on TestFlight is the integration signal.
- **Unchanged invariants:** (1) GraphQL schema unchanged. (2) `thread.status` server-side field remains. (3) `updateThread(input: { status })` mutation remains. (4) `message.durableArtifact` remains (out of scope). (5) Mobile's Cognito sync invariant and Google-OAuth session-restore paths (memory: `feedback_mobile_cognito_sync_invariant`, `project_mobile_auth_google_oauth`) are untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Removing the "Mark Done" button changes UX; an operator running a prod TestFlight may expect it. | Pre-v1; mobile is TestFlight-only. The button was backed by a retired product axis. Surface the decision explicitly in the PR body. |
| The two detail routes diverge in style after this slice (one gets a cleaner properties block than the other). | Both routes should get the same lifecycle badge + Trigger row. Enforce by eye during review. |
| `executeUpdateThread` import becomes unused after the Mark Done button is removed; dead import. | Grep post-edit and remove. |
| A pre-existing mobile typecheck baseline shifts. | Compare tsc output counts before/after. Fix any new errors in the same PR. |
| NativeWind animate-pulse class syntax differs from admin's Tailwind; the `RUNNING` badge may not pulse. | Acceptable first pass — the static dot color is what carries the signal. Animated pulse is a polish follow-up if product wants it. |
| `statusVariant` helper in `ActiveWorkSection.tsx` is used elsewhere. | Grep before deleting; only delete if truly orphaned. |
| Codegen regen surfaces unrelated schema drift. | Commit the drift as a separate hunk or a follow-up chore PR titled `chore(mobile): codegen regen drift` to keep U9's diff focused. |

---

## Documentation / Operational Notes

- No external docs reference the mobile status picker. Mobile has no public-facing docs.
- Post-merge: manual smoke on a TestFlight dev build. Focus on (a) thread-detail lifecycle badge renders per state, (b) list view lifecycle badge renders, (c) home card lifecycle badge renders, (d) the former picker is now read-only.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` (U9 block: lines 595–632).
- **Predecessors on `origin/main`:** U3d (#539) — schema-level retirement of status/priority/type; U4 (#546) — `lifecycleStatus` resolver; U6 (#549) — admin detail reshape with `ThreadLifecycleBadge`; U7 (#551) — admin list filter/sort/group cleanup; U8 (#553) — admin Traces "Open in X-Ray"; U10 (#554) — CLI flag cleanup.
- **Files touched by this slice:**
  - `apps/mobile/lib/graphql-queries.ts`
  - `apps/mobile/lib/gql/gql.ts` (codegen)
  - `apps/mobile/lib/gql/graphql.ts` (codegen)
  - `apps/mobile/app/thread/[threadId]/info.tsx`
  - `apps/mobile/app/thread/[threadId]/index.tsx`
  - `apps/mobile/app/threads/[id]/index.tsx`
  - `apps/mobile/app/threads/index.tsx`
  - `apps/mobile/components/home/ActiveWorkSection.tsx`
