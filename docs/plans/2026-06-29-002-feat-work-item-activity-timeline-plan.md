---
title: "feat: Improve Work Item activity timeline"
type: feat
status: active
date: 2026-06-29
origin: docs/brainstorms/2026-06-29-think-108-work-item-activities-requirements.md
---

# feat: Improve Work Item activity timeline

## Overview

Improve Work Item Activity so it reads as a useful timeline instead of a title-heavy audit dump. The implementation should keep the existing `work_item_events` model, enrich newly recorded Work Item events where current data is too generic, and move web-side event formatting into testable helpers that render semantic icons plus concise actor/action copy.

This is a scoped Work Item detail improvement, not a full Linear parity project.

---

## Problem Frame

The current Work Item Activity section can show rows like "`<title>` updated", which repeats the page title and hides the useful fact of what changed. THINK-108 asks for a core set of proper activity icons and activity text: status movement, assignment, priority, due date, labels, resources/thread links, comments, OpenEngine/agent actions, blocked/unblocked state, and applicability (see origin: `docs/brainstorms/2026-06-29-think-108-work-item-activities-requirements.md`).

The codebase already has a Work Item event stream. The plan is to make that stream useful by improving event capture for new changes and rendering existing event data more intelligently.

---

## Requirements Trace

- R1. Activity rows need event-specific icons for core activity types.
- R2. Actor identity must remain visible.
- R3. Activity copy must describe the action in concise sentence form.
- R4. The timeline must remain compact and scannable.
- R5. Status/progress events must show previous and new statuses when known.
- R6. Assignment events must name the new assignee and prior assignee when available.
- R7. Priority, due date, labels, required/applicable state, blocked state, and title/notes edits need field-specific rows or copy.
- R8. Resource, thread, or external-reference link activity must identify the linked thing.
- R9. Comments and OpenEngine/agent actions must retain distinct treatment with meaningful operational text.
- R10. Generic fallback copy is only acceptable when event sources lack detail, and must avoid title-heavy repetition.
- R11. Missing actors, deleted users, missing old values, and unknown events must degrade gracefully.
- R12. Icons and vocabulary must stay ThinkWork-native.
- R13. Representative core property changes need both useful text and recognizable icons.

**Origin actors:** A1 Work Item user, A2 Work Item actor, A3 Implementation planner
**Origin flows:** F1 Scan meaningful activity, F2 Record a property change
**Origin acceptance examples:** AE1 status movement, AE2 assignment, AE3 priority fallback quality, AE4 thread/resource link, AE5 OpenEngine/agent fallback quality

---

## Scope Boundaries

- Do not introduce full Linear parity, cycle activity, project activity, or unrelated issue-tracker concepts.
- Do not redesign the Work Item detail page or right-side Properties panel.
- Do not add Work Items page filters, display controls, saved views, board behavior, or list behavior.
- Do not make every backend audit table part of this feed.
- Do not expose raw metadata as the user-facing answer to unclear event rows.
- Do not require historical legacy events to become perfect if they lack enough recorded detail.
- Do not add a new event table or schema migration unless implementation proves the existing event shape cannot carry the required values.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/work-items/WorkItemDetailPage.tsx` owns the Work Item detail page, Activity section, event row rendering, actor labels, timeline connector, and current `activityTimelineMessage` fallback.
- `apps/web/src/components/work-items/work-item-display.ts` holds Work Item display types and pure display helpers with existing focused tests in `apps/web/src/components/work-items/work-item-display.test.ts`.
- `apps/web/src/lib/graphql-queries.ts` already fetches `events { actorUserId actorAgentId eventType previousStatusId newStatusId message metadata createdAt }` in `WorkItemQuery`.
- `packages/database-pg/src/schema/work-items.ts` defines `work_item_events` and currently allows the event types needed for this plan: `created`, `updated`, `status_changed`, `completed`, `blocked`, `unblocked`, `assigned`, `due_date_changed`, `applicability_changed`, `linked_thread`, `agent_action`, and `comment_added`.
- `packages/api/src/lib/work-items/work-item-service.ts` records Work Item creation, generic updates, comments, documents, status updates, and human OpenEngine actions. Generic `updateWorkItem` currently records `event_type: "updated"` with `changedFields`.
- `packages/api/src/lib/work-items/work-item-status-tool.ts` records agent/tool-driven status changes with previous/new status IDs, but its message is still title/source-heavy.
- `packages/api/src/lib/work-items/open-engine-receipt-service.ts` records OpenEngine agent receipts and mirrors some receipts as comments.
- `packages/api/src/graphql/resolvers/work-items/workItems.resolver.test.ts`, `packages/api/src/lib/work-items/work-item-status-tool.test.ts`, `packages/api/src/lib/work-items/open-engine-receipt-service.test.ts`, and `packages/api/src/lib/work-items/open-engine-queue-service.test.ts` already cover several event insertion paths.

### Institutional Learnings

- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` applies: reuse and improve the existing event substrate rather than building a parallel activity model.

### External References

- None. The local Work Item event model and existing UI patterns are sufficient; external framework research would not materially change this plan.

### Organizational Context

- Slack research was not requested. Slack context can be added later if organizational discussion about Work Item activity semantics exists outside the repo.

---

## Key Technical Decisions

- **Keep `work_item_events` as the activity substrate:** The existing event table already has actor, event type, status IDs, message, metadata, and timestamp fields. Adding a parallel feed would duplicate data and violate the local reuse pattern.
- **Use metadata actions for field-level variants under existing event types:** Some user-visible activity families, such as priority changes, do not have dedicated allowed event types. Represent them with `event_type: "updated"` plus structured metadata such as action/field changes, then let the UI map action families to icons and copy.
- **Generate better new messages but do not rely only on messages:** New events should avoid title-heavy message strings, but the web formatter should also derive useful text from `eventType`, status IDs, and metadata so old or sparse events degrade gracefully.
- **Extract web formatting into pure helpers:** Activity formatting and icon selection should move out of `WorkItemDetailPage.tsx` enough to be unit-tested without a full URQL/router render harness.
- **Status name resolution stays client-side:** `WorkItemQuery` already supplies previous/new status IDs and `WorkItemDetailPage` already loads Space statuses; the UI can map IDs to names without changing GraphQL.

---

## Open Questions

### Resolved During Planning

- **Should this require a schema migration?** No. The current `work_item_events` shape is sufficient for the plan. Use existing event types plus structured metadata unless implementation proves a hard blocker.
- **Should OpenEngine receipts remain comment-like in some cases?** Yes. Keep the current comment mirroring behavior for receipt types that are meant to read as agent/user-readable messages; improve compact timeline treatment for the event row itself.
- **Should historical generic rows be rewritten?** No. The requirement allows imperfect legacy events. Improve rendering fallbacks and make new representative events high quality.

### Deferred to Implementation

- **Exact field-change metadata shape:** Choose the smallest structured shape that supports copy and tests once the implementer is editing `work-item-service.ts`.
- **Exact icon mapping:** Use Tabler icons for Activity timeline markers so every activity family uses the same icon system and no custom circle glyphs are introduced.
- **Multi-field update behavior:** If one mutation updates several core fields, implementation should prefer multiple display-worthy event rows when practical; if this is too noisy or awkward in a path, render one concise row that names the changed fields.

---

## Implementation Units

- U1. **Extract Work Item activity display helpers**

**Goal:** Create a testable web-side activity formatter that maps Work Item events to semantic icon families and concise copy.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, R9, R10, R11, R12, R13; F1; AE1, AE2, AE3, AE4, AE5

**Dependencies:** None

**Files:**

- Create: `apps/web/src/components/work-items/work-item-activity.ts`
- Create: `apps/web/src/components/work-items/work-item-activity.test.ts`
- Modify: `apps/web/src/components/work-items/WorkItemDetailPage.tsx`
- Modify: `apps/web/src/components/work-items/work-item-display.ts` only if shared types need small additions

**Approach:**

- Move event classification, actor fallback, and activity-copy logic into pure helpers that accept the current event, current Work Item, statuses, assignees, and relevant metadata.
- Return a small descriptor such as icon family, tone/color family, actor label, action text, display mode, and fallback reason. Keep actual icon components in `WorkItemDetailPage.tsx` or map icon keys to components there so the helper stays pure.
- Resolve status copy from `previousStatusId` / `newStatusId` using loaded Work Item statuses.
- Resolve assignment copy from metadata first, then assignees/current item when possible, then neutral fallback.
- Preserve card-style rendering for comment rows and any OpenEngine receipt/comment cases that intentionally carry longer prose.

**Execution note:** Add helper tests before rewiring the component; this area currently has no focused Work Item activity test.

**Patterns to follow:**

- `apps/web/src/components/work-items/work-item-display.ts` and `apps/web/src/components/work-items/work-item-display.test.ts` for pure display helper shape.
- Existing compact timeline row structure in `apps/web/src/components/work-items/WorkItemDetailPage.tsx`.

**Test scenarios:**

- Happy path, Covers AE1: status event with previous Todo and new Done returns status/progress icon family and copy equivalent to "moved from Todo to Done".
- Happy path, Covers AE2: assigned event with metadata naming Eric returns assignment icon family and copy naming Eric.
- Happy path, Covers AE3: updated event with priority metadata returns priority icon family and "set priority to High" copy.
- Happy path, Covers AE4: linked thread/resource metadata returns link/resource icon family and ThinkWork-native resource copy.
- Happy path, Covers AE5: agent/OpenEngine event without human actor returns an agent/system actor label and meaningful operational text.
- Edge case: unknown event type returns neutral copy without raw metadata, broken labels, or full-title repetition.
- Edge case: missing old status or deleted assignee still returns readable "set status to X" / "assigned to X" copy.

**Verification:**

- Work Item activity formatting can be validated through focused helper tests without mounting the full detail page.
- `WorkItemDetailPage.tsx` delegates event wording/icon decisions to the helper and keeps comments readable.

---

- U2. **Enrich generic Work Item update events**

**Goal:** Ensure new core property changes record enough structured detail for the web formatter to produce field-specific rows instead of generic "`<title>` updated" copy.

**Requirements:** R3, R6, R7, R8, R10, R11, R13; F2; AE2, AE3, AE4

**Dependencies:** U1 can proceed independently, but U2 and U1 should converge on the same metadata vocabulary.

**Files:**

- Modify: `packages/api/src/lib/work-items/work-item-service.ts`
- Modify: `packages/api/src/graphql/resolvers/work-items/workItems.resolver.test.ts`
- Modify: `packages/api/src/lib/work-items/work-item-service.test.ts` if lower-level service coverage is more direct for a specific path

**Approach:**

- Replace the generic update event message for core fields with structured field-change metadata and non-title-heavy messages.
- Cover the core `updateWorkItem` fields from the origin scope: title, notes, priority, owner user/agent, due date, required, applicable, blocked, OpenEngine enabled/queue/scheduled/dependency/routing state, and archived state.
- For owner changes, prefer `event_type: "assigned"` with assignment metadata when the update is a clear assignment change. Preserve `event_type: "updated"` for non-assignment field changes.
- For due date and applicability changes, use existing allowed event types (`due_date_changed`, `applicability_changed`) where they fit.
- For labels, inspect `replaceWorkItemLabels` during implementation and either add field-change metadata to the surrounding update event or emit a display-worthy label event in the same transaction.
- Keep non-core or ambiguous fields on a generic update path, but with fallback-safe message text that does not lead with the full Work Item title.

**Patterns to follow:**

- Existing event insertion shape in `updateWorkItemStatus` and `recordOpenEngineHumanAction`.
- Existing `compactObject` usage for optional metadata.

**Test scenarios:**

- Happy path, Covers AE2: owner update inserts an assignment-oriented event with new assignee metadata.
- Happy path, Covers AE3: priority update records field-change metadata with new priority and a non-title-heavy message.
- Happy path: due date update records old/new due date detail where available and uses a due-date activity family.
- Happy path: applicable=false and blocked=true updates record distinct metadata/action values that can drive skipped/applicability and blocked icons.
- Edge case: a notes-only or title-only update records enough field detail to avoid a generic title repetition row.
- Edge case: a multi-field update either emits separate display-worthy events or a single event with all changed fields represented in metadata.

**Verification:**

- Resolver/service tests assert event insert payloads include the new metadata and no longer rely on "`<title>` updated" for representative core changes.

---

- U3. **Improve status, agent, and OpenEngine event wording**

**Goal:** Remove title/source-heavy wording from status and OpenEngine paths so UI rows are useful for both human and agent-driven activity.

**Requirements:** R3, R5, R9, R10, R11, R13; F2; AE1, AE5

**Dependencies:** Coordinate metadata expectations with U1.

**Files:**

- Modify: `packages/api/src/lib/work-items/work-item-service.ts`
- Modify: `packages/api/src/lib/work-items/work-item-status-tool.ts`
- Modify: `packages/api/src/lib/work-items/open-engine-receipt-service.ts`
- Modify: `packages/api/src/lib/work-items/open-engine-queue-service.ts`
- Modify: `packages/api/src/graphql/resolvers/work-items/workItems.resolver.test.ts`
- Modify: `packages/api/src/lib/work-items/work-item-status-tool.test.ts`
- Modify: `packages/api/src/lib/work-items/open-engine-receipt-service.test.ts`
- Modify: `packages/api/src/lib/work-items/open-engine-queue-service.test.ts`

**Approach:**

- Keep previous/new status IDs as the authoritative status transition data.
- Change newly generated status messages so they are concise and actor-neutral enough for the UI to combine with the actor label, e.g. "moved to Done" rather than "`<title>` moved to Done by set_work_item_status."
- Preserve notes in metadata and, when useful, append them in a secondary sentence only when the UI path can display it without clutter.
- For OpenEngine receipts and queue routing, keep idempotency and comment mirroring behavior intact while making compact event-row copy explain the operational action.
- Avoid changing external tool contracts; this is event-recording and presentation quality, not a status-tool API redesign.

**Patterns to follow:**

- Existing idempotency checks in `work-item-status-tool.ts`, `open-engine-receipt-service.ts`, and `open-engine-queue-service.ts`.
- Existing receipt mirroring logic in `open-engine-receipt-service.ts` and mirrored-comment filtering in `WorkItemDetailPage.tsx`.

**Test scenarios:**

- Happy path, Covers AE1: GraphQL status update event keeps previous/new status IDs and stores concise transition text.
- Happy path: `set_work_item_status` event keeps previous/new status IDs, actor metadata, thread/tool-call metadata, and concise transition text.
- Happy path, Covers AE5: OpenEngine blocked/unblocked/done receipt stores an operational message suitable for compact rendering and still mirrors configured receipt types as comments.
- Edge case: repeated idempotency keys still return existing events/comments and do not duplicate activity rows.
- Error path: unauthorized or unlinked status-tool updates keep existing rejection behavior.

**Verification:**

- Existing API tests continue to prove idempotency and authorization behavior while adding assertions for improved event text/metadata.

---

- U4. **Wire semantic icons and compact timeline rendering**

**Goal:** Apply the activity descriptors from U1 in `WorkItemDetailPage.tsx` so users see event-specific icons and concise timeline text.

**Requirements:** R1, R2, R3, R4, R9, R11, R12, R13; F1; AE1, AE2, AE3, AE4, AE5

**Dependencies:** U1

**Files:**

- Modify: `apps/web/src/components/work-items/WorkItemDetailPage.tsx`
- Modify: `apps/web/src/components/work-items/work-item-activity.ts`
- Test: `apps/web/src/components/work-items/work-item-activity.test.ts`
- Test: create `apps/web/src/components/work-items/WorkItemDetailPage.test.tsx` only if helper tests cannot cover a rendering-specific regression

**Approach:**

- Replace compact event-row `ActivityAvatar` usage with semantic activity icons for property-change rows.
- Keep actor identity visible in text, as required by the origin doc, instead of relying on avatar initials.
- Preserve existing timeline connector and timestamp behavior.
- Keep full cards for comments and any non-compact events where the message body is the content.
- Use Tabler icons for activity markers; add small, familiar icons for priority, assignment, due date, link/resource, comment, status movement, blocked/unblocked, and agent/OpenEngine.

**Patterns to follow:**

- Existing `ActivityEventRow` compact timeline layout.
- Frontend guidance in repo instructions: use lucide icons for buttons/icons when available, keep UI dense and scannable, avoid text overlap.

**Test scenarios:**

- Happy path, Covers AE1: status descriptor renders with a semantic status icon key and actor/action text.
- Happy path, Covers AE2: assignment descriptor renders with a semantic assignment icon key and actor/action text.
- Happy path, Covers AE5: OpenEngine descriptor distinguishes system/agent actor text from event icon.
- Edge case: long titles in event metadata do not dominate the compact row copy or replace the actual action.
- Rendering smoke: if `WorkItemDetailPage.test.tsx` is added, a minimal mocked Work Item with events renders Activity rows with expected action text and timestamps.

**Verification:**

- Activity rows for representative events no longer use actor initials as the only marker and no longer render title-heavy generic copy.

---

- U5. **Preserve GraphQL and generated type parity**

**Goal:** Ensure any event metadata/type changes remain visible to web and mobile generated clients without widening the API unnecessarily.

**Requirements:** R10, R11, R13

**Dependencies:** U2, U3

**Files:**

- Modify: `packages/database-pg/graphql/types/work-items.graphql` only if implementation must expose additional event fields beyond existing `metadata`
- Modify: `apps/cli/src/gql/graphql.ts` if codegen output changes
- Modify: `apps/web/src/gql/graphql.ts` if codegen output changes
- Modify: `apps/mobile/lib/gql/graphql.ts` if codegen output changes
- Test: `apps/web/src/lib/graphql-queries.schema.test.ts`
- Test: `packages/api/src/__tests__/graphql-contract.test.ts`

**Approach:**

- Prefer existing `metadata` and existing event fields so GraphQL schema changes are unnecessary.
- If implementation proves new typed fields are needed, update canonical GraphQL first, then regenerate all consumers with codegen as required by repo instructions.
- Keep CLI, web, and mobile generated types current if schema/codegen changes happen, even though THINK-108 is a web Work Item detail issue.

**Patterns to follow:**

- AGENTS.md GraphQL guidance: canonical GraphQL lives under `packages/database-pg/graphql/types/*.graphql`; regenerate codegen for every consumer with a `codegen` script after editing GraphQL types.
- Existing GraphQL schema tests in `apps/web/src/lib/graphql-queries.schema.test.ts` and `packages/api/src/__tests__/graphql-contract.test.ts`.

**Test scenarios:**

- Test expectation: none if no schema or generated type changes are needed.
- Integration: if schema changes are needed, schema contract tests should prove `WorkItemEvent` fields remain compatible with `WorkItemQuery`.

**Verification:**

- No stale generated GraphQL artifacts remain if schema changes are made.

---

## System-Wide Impact

- **Interaction graph:** Work Item activity starts at GraphQL/API mutations and Agent/OpenEngine services, persists through `work_item_events`, flows through Work Item GraphQL resolvers, and renders in the web Work Item detail page.
- **Error propagation:** Event formatting must never break Work Item detail rendering. Unknown/missing event data should degrade to neutral fallback text.
- **State lifecycle risks:** Multi-field updates can produce noisy activity if every field becomes a row. The implementation should make representative core changes visible without flooding the feed for routine bulk updates.
- **API surface parity:** Prefer no schema change. If schema changes become necessary, web and mobile generated GraphQL artifacts must both be regenerated.
- **Integration coverage:** Unit tests should cover pure formatting and event insert payloads; full deployed AWS verification is not required for this plan, but browser smoke is useful during implementation because the issue is visual.
- **Unchanged invariants:** Work Item permissions, status transition rules, OpenEngine idempotency, receipt mirroring, and comment creation behavior should not change.

---

## Risks & Dependencies

| Risk                                                              | Mitigation                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Event metadata becomes an untyped dumping ground                  | Keep a small documented metadata shape in helper tests and API assertions, scoped to activity display needs.               |
| UI derives misleading copy from partial legacy events             | Prefer explicit metadata/status IDs; use neutral fallbacks when values are missing.                                        |
| Multi-field updates create too many rows                          | Keep implementation judgment in U2: separate high-value field changes where practical, otherwise summarize changed fields. |
| OpenEngine receipt changes break idempotency or mirrored comments | Preserve existing tests and add wording assertions without altering idempotency keys or mirror rules.                      |
| GraphQL/schema changes create generated-code drift                | Prefer existing fields; if schema changes occur, regenerate all consumers and run schema contract checks.                  |

---

## Documentation / Operational Notes

- No user-facing docs are required for this UI-quality change.
- The Linear issue should carry a concise plan summary and the plan path so implementation can be picked up from the issue.
- During implementation, browser verification should inspect a Work Item with representative activity rows after the web dev server is configured with the ignored `apps/web/.env` per repo instructions.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-29-think-108-work-item-activities-requirements.md](../brainstorms/2026-06-29-think-108-work-item-activities-requirements.md)
- Related issue: `THINK-108`
- Related code: `apps/web/src/components/work-items/WorkItemDetailPage.tsx`
- Related code: `apps/web/src/components/work-items/work-item-display.ts`
- Related code: `apps/web/src/lib/graphql-queries.ts`
- Related code: `packages/api/src/lib/work-items/work-item-service.ts`
- Related code: `packages/api/src/lib/work-items/work-item-status-tool.ts`
- Related code: `packages/api/src/lib/work-items/open-engine-receipt-service.ts`
- Related code: `packages/api/src/lib/work-items/open-engine-queue-service.ts`
- Related schema: `packages/database-pg/src/schema/work-items.ts`
- Institutional learning: `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
