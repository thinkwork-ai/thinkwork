---
date: 2026-06-29
topic: think-108-work-item-activities
---

# Work Item Activities

## Problem Frame

Work Item activity rows are supposed to help a user understand what changed on a Work Item without rereading the surrounding page. Today the feed can repeat the Work Item title with generic text such as "updated", which makes the row low-value and obscures useful changes like assignment, status, priority, due date, resource links, comments, or OpenEngine activity.

THINK-108 should make the Work Item activity feed feel closer to a Linear-style timeline: compact rows, event-specific icons, named actors, and short sentences that describe the actual change. The target scope is the core Work Item property-change timeline, not full Linear activity parity.

---

## Actors

- A1. Work Item user: scans a Work Item detail page and needs to understand recent changes quickly.
- A2. Work Item actor: changes a Work Item through the UI, chat, agent tooling, or automation and expects the resulting activity row to explain their action.
- A3. Implementation planner: maps the desired event language to the existing Work Item event sources without inventing new product scope.

---

## Key Flows

- F1. Scan meaningful activity
  - **Trigger:** A user opens a Work Item detail page and expands Activity.
  - **Actors:** A1
  - **Steps:** The user sees a chronological feed, identifies event types by icon, reads actor-plus-action text, and can tell what changed without opening raw metadata.
  - **Outcome:** The activity feed explains recent Work Item changes at a glance.
  - **Covered by:** R1, R2, R3, R4

- F2. Record a property change
  - **Trigger:** A Work Item actor changes a core property such as assignee, status, priority, due date, labels, required/applicable state, block state, resource/thread link, or OpenEngine routing/state.
  - **Actors:** A2
  - **Steps:** The change is persisted, the activity row receives enough event detail to describe before/after or newly set values when relevant, and the detail page renders the row with a type-specific icon and sentence.
  - **Outcome:** The feed says what happened, not just that the Work Item was updated.
  - **Covered by:** R5, R6, R7, R8, R9

---

## Requirements

**Timeline presentation**

- R1. Work Item activity rows must use event-specific visual icons for core activity types instead of using actor initials as the only timeline marker for property-change events.
- R2. Each row must keep the actor visible in the activity text or adjacent row chrome so users can tell who or what performed the action.
- R3. Activity copy must describe the actual action in concise sentence form, following the Linear-style pattern of "Actor changed X from A to B" or "Actor set X to Y" when the old value is not meaningful.
- R4. The feed must preserve chronological scanability: compact row height, timeline connector treatment where useful, readable timestamps, and no title-heavy repetition that crowds out the change description.

**Core activity coverage**

- R5. Status and progress events must show the previous and new status when both are known, and must distinguish completed, blocked, unblocked, skipped/not applicable, and ordinary status movement when the Work Item model exposes those states.
- R6. Assignment events must name the new assignee, and should name the prior assignee or unassigned state when available.
- R7. Priority, due date, labels, required/applicable state, blocked state, and title/notes edits must render as field-specific activity rows rather than one generic "updated" row when those fields change.
- R8. Resource, thread, or external-reference link activity must identify what kind of thing was linked or removed, using Work Item language rather than generic update language.
- R9. Comments and OpenEngine/agent action events must retain their distinct treatment: comments remain readable message rows, while agent/OpenEngine events use activity text that explains the operational action or receipt rather than only exposing the raw event type.

**Fallbacks and quality bar**

- R10. Generic fallback copy is allowed only when the event source lacks enough detail to describe the field-level change; fallback rows must still avoid repeating the full Work Item title as the primary content.
- R11. Activity text must handle missing actors, deleted users, missing old values, and unknown event types gracefully with neutral language such as "System" or "changed the status" rather than broken labels.
- R12. The icon set and text vocabulary must be Work Item-native and ThinkWork-native; do not import Linear-specific concepts such as cycles unless ThinkWork has an equivalent property in scope.
- R13. The requirements are satisfied only when the representative core property changes in THINK-108's scope have both useful text and a recognizable event icon.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5.** Given a Work Item status changes from Todo to Done, when Activity renders, then the row uses a status/progress icon and text equivalent to "Eric Odom moved from Todo to Done" rather than only "changed the status" or "`<title>` updated."
- AE2. **Covers R1, R3, R6.** Given Eric is assigned to a Work Item, when Activity renders, then the row uses an assignment icon and names Eric as the assignee.
- AE3. **Covers R7, R10.** Given priority changes to High, when Activity renders, then the row says the priority was set to High. If a legacy event lacks the old value, the row still says what is known rather than repeating the Work Item title.
- AE4. **Covers R8, R12.** Given a thread resource is linked to a Work Item, when Activity renders, then the row identifies that a thread/resource was linked using ThinkWork vocabulary.
- AE5. **Covers R9, R11.** Given an OpenEngine or agent event lacks a human actor, when Activity renders, then the row uses a clear system/agent actor label and meaningful operational text without a broken avatar or raw event-type-only sentence.

---

## Success Criteria

- A Work Item user can scan the Activity section and understand what changed without comparing current properties against memory or raw metadata.
- Core Work Item activity types have distinct icons and action-specific copy that resembles the clarity of Linear's activity timeline while staying ThinkWork-native.
- Planning can proceed without re-deciding whether THINK-108 is a broad Linear clone; the chosen scope is core Work Item property-change activity.
- Generic fallback rows become rare and acceptable only for events whose source does not yet carry enough detail.

---

## Scope Boundaries

- Do not build full Linear activity parity, cycle activity, project activity, or unrelated issue-tracker concepts unless ThinkWork already has an equivalent Work Item property.
- Do not redesign the full Work Item detail page or right-side Properties panel as part of this work.
- Do not add saved views, filters, board/list display controls, or other Work Items page behavior.
- Do not make every backend audit table part of the Work Item Activity feed.
- Do not expose raw metadata as the user-facing answer to unclear event rows.
- Do not require historical legacy events to become perfect if they were recorded without enough detail; improve graceful rendering and make new representative events high-quality.

---

## Key Decisions

- **Core property-change scope:** Eric selected the core Work Item property-change set over a minimal existing-event cleanup or a full Linear-parity activity model.
- **Clarity over title repetition:** The row's value comes from explaining the change; the Work Item title should not dominate routine activity rows on the detail page.
- **Icons are semantic:** Property-change rows need activity-type icons so the feed can be scanned visually, while actor identity remains available through text or adjacent UI.
- **ThinkWork vocabulary wins:** Linear is the quality reference for concise activity language, not a source of foreign product concepts.

---

## Dependencies / Assumptions

- Verified context: `apps/web/src/components/work-items/WorkItemDetailPage.tsx` currently renders Work Item comments and events in the Activity section.
- Verified context: `apps/web/src/components/work-items/WorkItemDetailPage.tsx` already uses event messages when present but falls back to generic text such as "changed the status" or title-heavy update messages.
- Verified context: `packages/database-pg/src/schema/work-items.ts` defines `work_item_events` with event types including created, updated, status_changed, completed, blocked, unblocked, assigned, due_date_changed, applicability_changed, linked_thread, agent_action, and comment_added.
- Verified context: `packages/database-pg/graphql/types/work-items.graphql` exposes Work Item events with actor IDs, previous/new status IDs, message, metadata, and timestamp.
- Assumption: planning may need to improve event capture for some property changes so new events contain enough detail for high-quality copy.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5, R6, R7][Technical] Identify which core property changes already record before/after detail and which need richer event metadata or field-specific event messages.
- [Affects R1, R13][Design] Choose the exact icon mapping for each activity family using the web app's existing icon system and visual language.
- [Affects R9][Technical] Decide whether any OpenEngine receipt types should continue to render as comment-like cards instead of compact timeline rows.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
