---
date: 2026-06-25
topic: thread-work-items
---

# Thread Work Items

## Problem Frame

ThinkWork now has native Work Items as the durable ledger for user tasks, but the Spaces thread Progress experience still carries older filesystem and linked-task task-list references. THNK-76 should hard cut over thread task progress to Work Items: when a Space thread needs task progress, it should create and operate on Work Items, and the thread Info Panel should become a Work Items-backed progress surface rather than a rendered filesystem checklist.

The user-facing outcome is simple: operators and agents continue to see and update thread progress from chat and the Info Panel, but the canonical state is Work Items. Thread task status, assignment, completion, blocker, and skip state should be visible from both the thread context and the main Work Items page without duplicate task systems.

---

## Actors

- A1. Space operator: reviews thread progress, changes status or assignee, and expects the main Work Items page to reflect the same state.
- A2. Thread agent: creates or updates task progress from chat while working in a Space thread.
- A3. Implementation planner: removes the legacy thread task source and cuts customer-onboarding/thread progress over to Work Items.

---

## Key Flows

- F1. Create thread tasks as Work Items
  - **Trigger:** A new Space thread or workflow creates task-like progress items.
  - **Actors:** A2
  - **Steps:** The workflow identifies task candidates, creates native Work Items in the thread's Space, links each Work Item to the thread, and exposes them in the thread Progress panel.
  - **Outcome:** The thread has durable Work Items, not a filesystem-only checklist, progress markdown task list, or linked-task record, as its canonical progress state.
  - **Covered by:** R1, R2, R3, R4

- F2. Update Work Item progress from chat
  - **Trigger:** A human or agent says that a thread task is done, blocked, started, skipped, or otherwise changed.
  - **Actors:** A1, A2
  - **Steps:** The chat update resolves to the matching linked Work Item, applies the status update through the Work Item update path, records provenance, and refreshes the thread Progress panel.
  - **Outcome:** Natural chat mutations keep working, but they mutate Work Items instead of the old thread task store.
  - **Covered by:** R5, R6, R7

- F3. Edit Progress rows from the Info Panel
  - **Trigger:** An operator opens a Space thread's Info Panel and wants to update progress directly.
  - **Actors:** A1
  - **Steps:** The operator clicks a Work Item status icon, selects a Space status from the Work Items badge selector pattern, optionally clicks the assignee badge, and selects Unassigned or a Space member.
  - **Outcome:** The Work Item updates in place, progress totals update, and the same change is visible on `/work-items`.
  - **Covered by:** R8, R9, R10, R11, R12

---

## Requirements

**Canonical task source**

- R1. Space thread task progress must use native Work Items as the canonical task record whenever new thread progress items are created.
- R2. New thread task creation must link each Work Item to the originating thread so `threadWorkItems` can power the thread Progress panel and Work Items can point back to their thread context.
- R3. The legacy filesystem/markdown checklist and linked-task model must be removed from thread task progress rather than retained as user-facing task sources.
- R4. THNK-76 is a hard cutover: after it lands, thread task progress reads and writes Work Items only, with no migration phase, read-through bridge, fallback rendering, or lazy-conversion layer.

**Chat mutation behavior**

- R5. Existing chat-driven task mutations must continue to work for Work Items: done/completed, in progress, blocked, skipped/not applicable, and similar progress phrases should update the matching Work Item.
- R6. Chat mutations must record enough provenance for trust: actor, thread context, status change, note or evidence when available, and timestamp.
- R7. Agents should prefer the native Work Item status tool path for Work Item-backed thread progress and should not edit `PROGRESS.md` or checklist markdown as the task source of truth.

**Thread Info Panel**

- R8. The Thread Info Panel Progress section must render linked Work Items for thread progress and retain the existing progress summary shape: required-complete count, percent badge, progress bar, row list, refresh affordance, and updated-at signal where available.
- R9. Each Progress row's status icon must be clickable and open the same status-selection interaction pattern used by the Work Items page: searchable statuses, current selection, and Space-configured status labels/colors.
- R10. Each Progress row's assignee affordance must be clickable and open the same assignee-selection interaction pattern used by the Work Items page: searchable users, Unassigned, current selection, and avatar/initial styling.
- R11. Thread Progress assignee choices must be restricted to users assigned to the Space, not every tenant member.
- R12. Direct Info Panel updates must mutate the Work Item, refresh the thread progress display, and keep `/work-items` consistent after refresh or navigation.

**Removal and consistency**

- R13. The user-facing thread task list must not read from progress markdown or linked tasks after the hard cutover; Work Items are the only thread Progress row source.
- R14. The cutover must remove legacy thread-task UI/API paths that invite thread tasks to be created or updated outside Work Items.
- R15. Empty, loading, and error states must use Work Item language after the cutover; avoid "No linked tasks" for the canonical Work Items path.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a new customer-onboarding Space thread creates seven progress tasks, when the thread opens, then `threadWorkItems` returns seven linked Work Items and the Info Panel renders those rows without relying on a markdown checklist as the authority.
- AE2. **Covers R5, R6, R7.** Given a thread has a linked Work Item named "Run credit check", when the agent says the credit check is complete through chat, then that Work Item moves to a done status and records the agent/thread provenance.
- AE3. **Covers R8, R9, R12.** Given a Progress row is Todo, when an operator clicks its status icon and selects In progress, then the row updates, the progress summary recalculates when appropriate, and `/work-items` shows the same status after refresh.
- AE4. **Covers R10, R11, R12.** Given a Space has Amy, Brett, and Eric assigned, when an operator edits a Progress row assignee, then the picker shows Unassigned plus those Space members and does not show unrelated tenant users.
- AE5. **Covers R13, R14, R15.** Given a thread has Work Items, when the Info Panel renders, then the user sees one Progress list using Work Item labels and no progress-markdown or linked-task fallback copy.

---

## Success Criteria

- Operators can update thread task status and assignee from the Info Panel using the Work Items selector patterns shown in THNK-76 screenshots.
- Agents and humans can still drive task updates through chat, but the durable state lands in Work Items.
- Newly created thread progress is visible from both the thread Progress panel and the main Work Items page without duplicate task systems.
- Planning can proceed without re-deciding whether Work Items or filesystem/linked-task progress owns task state, and without designing any cutover bridge.

---

## Scope Boundaries

- Do not redesign the entire Work Items page as part of THNK-76; reuse the current status and assignee selector patterns.
- Do not add new global status categories beyond the existing Work Item status model.
- Do not expose tenant-wide assignee choices in the thread Progress panel; Space membership is the boundary.
- Do not preserve the legacy task system as a parallel product path for thread progress.
- Do not remove unrelated thread goal files, artifacts, records, or workspace projections just because task progress moves to Work Items.
- Do not keep progress markdown, linked tasks, or `set_task_status` as fallback thread-task paths.
- Do not build external tracker sync in this cutover.

---

## Key Decisions

- **Work Items are the source of truth.** This continues the THNK-69 decision that Threads are collaboration/case-file surfaces while Work Items own task state.
- **Thread Progress remains a first-class surface.** The Info Panel should stay useful and compact, but its rows should be Work Item rows.
- **Reuse Work Items controls.** The status and assignee interactions should match the Work Items page rather than inventing thread-only controls.
- **Space membership constrains assignees.** Thread progress belongs to the Space context, so assignment choices should be the Space's assigned users.
- **Hard cut over, do not bridge.** No active user depends on the old thread task path, so THNK-76 should remove linked-task and progress-markdown task references rather than carry compatibility code.

---

## Dependencies / Assumptions

- Verified context: THNK-69's Linear requirements document defines native Work Items as the durable task/work tracking system and keeps Threads as collaboration records.
- Verified context: `packages/database-pg/graphql/types/work-items.graphql` exposes `threadWorkItems`, `workItemStatuses`, `updateWorkItemStatus`, and `updateWorkItem`.
- Verified context: `apps/web/src/components/workbench/SpacesThreadDetailRoute.tsx` already queries `threadWorkItems` and currently has fallback logic to progress markdown and linked tasks; THNK-76 should remove that fallback for thread task progress.
- Verified context: `apps/web/src/components/work-items/WorkItemListRow.tsx` contains the status icon selector and assignee selector patterns shown in the THNK-76 screenshots.
- Verified context: `packages/pi-extensions/src/task-status.ts` exposes both legacy `set_task_status` and native `set_work_item_status`.
- Verified context: `packages/api/src/lib/spaces/customer-onboarding-workflow.ts` already marks customer-onboarding goals with `progress_model: "work_items"`.
- Decision from Eric on 2026-06-25: no one is using the old thread task path, so make a hard cutover to Work Items and remove migration/read-through/fallback layers.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R11][Technical] Identify the exact Space membership query shape the Info Panel should use for assignee choices.
- [Affects R7, R13, R14][Technical] Identify and remove thread-task references to progress markdown, linked-task queries/mutations, and legacy `set_task_status` update paths while leaving unrelated non-thread integrations alone.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
