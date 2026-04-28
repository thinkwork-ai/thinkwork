---
title: Audit existing UI surfaces and data models before building parallel ones — the Inbox-pivot pattern
date: 2026-04-28
category: docs/solutions/design-patterns
module: admin/workspace-reviews
problem_type: design_pattern
component: development_workflow
severity: medium
applies_when:
  - "Designing a new operator UI surface (admin tab, dashboard page, sidebar entry) for a feature"
  - "Plan proposes a new queue UI for items with status, decided_by, decision verbs, and audit fields"
  - "Existing inbox/queue/review table appears underused or marked for removal"
  - "Plan calls for several new admin components plus mutations for an approve/reject/request-revision flow"
related_components:
  - admin
  - database
  - graphql_api
tags:
  - design-pattern
  - ui-reuse
  - data-model-reuse
  - planning
  - inbox
  - workspace-reviews
  - challenge-premise
  - audit-before-build
---

# Audit existing UI surfaces and data models before building parallel ones — the Inbox-pivot pattern

## Context

When scoping a new operator-facing surface for a feature, the default reflex is to design that surface from scratch: a new sidebar entry, a new tab, a new queue UI, a new count badge, a new GraphQL query for the badge. The reflex is reinforced by feature-driven planning — the master plan owns "the workspace-reviews experience," so it owns the UI for it.

This reflex misses a recurring shape in operator tooling. Many features reduce to **a queue of items with `status`, `decided_by`, `decided_at`, decision actions (approve/reject/request-revision), an audit log, and a typed payload renderer**. When that shape already exists in the codebase serving a different domain, building a parallel surface duplicates schema, components, mutations, subscriptions, and operator mental model — for no semantic gain.

The workspace-reviews routing refactor (PRs #674–#685, April 2026) hit exactly this fork. The original plan called for extracting a system-review queue UI from the standalone `/workspace-reviews` page into Automations, adding a `pendingSystemReviewsCount` GraphQL query, adding a sidebar badge fetch, and wiring a new "Pending HITL" tab. During U2 implementation, while wiring up the new contract, the implementer read `packages/database-pg/src/schema/inbox-items.ts` and noticed that `inbox_items` already carried every column the new feature needed (`type`, `status`, `entity_type`/`entity_id`, `decided_by`, `decided_at`, `review_notes`, `revision`, `config` jsonb), and the existing `apps/admin/src/routes/_authed/_tenant/inbox/$inboxItemId.tsx` detail view already rendered Approve / Reject / Request-revision actions through `InboxItemPayloadRenderer`. The pivot to materialize workspace reviews as `inbox_items` rows with `type='workspace_review'` collapsed U4 to 11 files / +915/-4 lines (#681), with no new admin components, no badge query, no count query, no new tab.

## Guidance

Before building a new operator UI surface for a feature, run this 5-step audit:

1. **Enumerate the new UI's data needs.** List required columns/fields/relations: identifiers, status, owner/decider, decision verbs, audit fields, payload shape.
2. **Search existing schema for matching column families.** Especially look at tables originally built for a now-deprecated or adjacent feature — the underlying domain (queue + status state machine + decision verbs + audit) recurs across operator tooling.
3. **Search existing routes/components for matching render shape.** A queue-with-actions list and a typed-payload detail view are generic; if one renders for tasks/inbox/notifications, it can usually render for the new domain.
4. **Score the fit.** If ≥ 4 of the 5 column families fit and the existing UI already has the action verbs you need, pivot. If you're inventing new columns or new action verbs to make it fit, build new.
5. **Quantify the bridge cost.** Reuse usually requires a small addition: a new `type` value, a new payload renderer branch, server-side mutation forwarding (e.g. `approveInboxItem` → `acceptAgentWorkspaceReview`), a write hook to materialize rows from the source-of-truth domain event. Compare that bridge cost against the parallel-surface cost (new query, new components, new sidebar entry, new state, new subscriptions). The bridge almost always wins.

This is a **planning-time and code-review-time check**. Apply it when reading a plan that proposes "new sidebar entry + new tab + new queue UI" for a feature whose shape is generic.

## Why This Matters

- **Implementation cost collapses.** U4 went from "extract queue UI + new badge query + new tab + new count GraphQL field + new admin components" to "11 files, +915/-4 lines, no new admin components." The bridge — a server-side materialization hook, three mutation branches, a payload renderer, a 5-line sidebar move, a backfill script — is the entire feature surface.
- **Operator mental model stays unified.** Operators already know the inbox. A separate "Pending HITL" tab in Automations would have introduced a second queue idiom — same column families, different rendering. Two surfaces mean operators learn two patterns and have to context-switch between them.
- **Subscriptions, real-time updates, audit log, comments, activity feed all come for free.** The existing inbox detail view already wires AppSync subscriptions, comment threads, and an activity log. A parallel surface re-implements each of those from scratch.
- **Dead code stops being dead code.** The `inbox_items` table predated the workspace-reviews feature and was at risk of being a load-bearing-but-niche table. Extending it with `type='workspace_review'` made it a true generic queue model, justifying its complexity rather than orphaning it.
- **Counter-example sets the boundary.** The companion auto-memory rule `feedback_ui_fabrication_test` covers the *opposite* failure mode: don't restructure storage to give a UI a fabricated affordance. The two patterns triangulate the rule — synthesize UI from existing storage when the domain shape already exists; don't synthesize storage from a UI need that the existing model already supports.

## When to Apply

**Apply when:**

- A plan proposes "new sidebar entry + new tab + new queue UI" for a feature whose data shape is "items with `status`, `owner/decider`, `decision verbs`, `audit fields`."
- A previously-active feature was retired and its model/UI is dead code looking for a purpose. (See also the synthetic `agents/` UI grouping decision in `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md` — same family of "use existing substrate, fabricate the section in UI.")
- During `ce-doc-review` of a plan document — when you see a plan proposing to *extract* components from an existing UI to build a parallel UI, challenge the premise. The same components can usually serve both, with the existing detail route as the host.
- The new feature's decision verbs (approve/reject/request-revision/dismiss/etc.) match an existing model's status state machine.

**Don't apply when:**

- The existing model has different invariants or auth boundaries (different tenant isolation rules, different status state machine, different RLS policy). See `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` for the related "narrow new surface vs widen existing" decision when auth is at stake.
- The existing UI is already overloaded and adding another `type` would make it confusing for operators.
- The new feature genuinely needs new action verbs or columns that the existing model can't represent without contortion. ("Contortion" smell: adding a parallel column whose meaning depends on `type`, or adding a status value that breaks the existing state machine for unrelated types.)
- The decision-verb semantics conflict (e.g., "approve" in the existing model is a soft hint, but the new feature needs "approve" to be a strong commitment with side-effects). Server-side bridging can paper over this once or twice; beyond that you're building a different model on top of the same table.

## Examples

### Example 1 (this case): Workspace reviews → Inbox

**Original plan (master plan, April 28):**

- New "Pending HITL" tab on Automations sidebar entry, with count badge
- New `pendingSystemReviewsCount` GraphQL query for the badge
- New admin queue components, extracted from `/workspace-reviews`
- Routing logic to filter system reviews

**Audit findings:**

| Required column | `inbox_items` already has? |
|---|---|
| Identifier + entity link | Yes — `entity_type='agent_workspace_run'` + `entity_id` |
| Status state machine | Yes — `pending` / `approved` / `rejected` / `revision_requested` |
| Decision audit | Yes — `decided_by`, `decided_at` |
| Review payload | Yes — `review_notes`, `revision`, `config` (jsonb) |
| Type discriminator | Yes — `type` column, add `'workspace_review'` value |

Existing UI fit: `apps/admin/src/routes/_authed/_tenant/inbox/$inboxItemId.tsx` already rendered Approve / Reject / Request-revision via `InboxItemPayloadRenderer`. All 5 columns fit. All 3 verbs fit.

**Pivoted plan (#680):** Revised R3, R4, R10; added R11 (bridge mapping) and R12 (idempotency); rewrote U4 wholesale.

**Pivoted implementation (#681) — 11 files, +915/-4 lines:**

- `packages/api/src/lib/workspace-events/inbox-materialization.ts` — server-side write hook turning workspace-review domain events into `inbox_items` rows
- 3 bridge branches in existing inbox mutation files: `approveInboxItem` → `acceptAgentWorkspaceReview`, `rejectInboxItem` → `cancelAgentWorkspaceReview`, `requestRevisionInboxItem` → `resumeAgentWorkspaceRun`
- One new payload renderer branch for `type='workspace_review'`
- 5-line sidebar move (Manage → Work)
- One-shot backfill script for existing pending reviews

**Did not need:** new admin components, new sidebar badge query, new `pendingSystemReviewsCount` GraphQL field, new tab UI, new subscriptions, new activity log, new comment thread.

### Example 2 (cousin pattern, applied earlier): `agents/` folder is UI fabrication, not storage

(auto memory) The original instinct was to restructure FOG storage so routed top-folders lived under an `agents/` segment. After `ce-doc-review`, the team committed to keeping storage FOG-pure and synthesizing the `agents/` section in `FolderTree` at render time. Same family of move: don't change the underlying substrate to provide a UI affordance the substrate already supports — fabricate the affordance in UI. See `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md` for the runbook on operating that synthetic-UI grouping cleanly.

### Example 3 (counter-example, when to build new)

If the new feature were "real-time agent escalation paging" with sub-second SLA, single-operator claim-locks, and pager-style escalation chains, `inbox_items` would be the wrong host: the existing model has no claim semantics, no escalation state, and the inbox UI isn't designed for sub-second updates. Bridge cost would be: new claim columns, new escalation columns, new realtime channel, new claim-aware UI. That's a different model — build new.

### Audit-time questions to ask out loud

- "What columns does this new UI need?"
- "Which existing tables have those columns? Search the schema directory."
- "Which existing routes already render this shape? Open the routes directory and grep for the action verbs."
- "If we add a `type='X'` value to the existing table, what breaks? What auth boundaries does it cross?"
- "What's the bridge — a write hook, a mutation forwarder, a payload renderer branch? Sketch it. Compare LOC to the parallel-surface plan."

If the bridge sketch is < 25% of the parallel-surface plan and no auth/invariant boundaries are crossed, pivot.

## Related

- `docs/solutions/workflow-issues/agent-builder-smoke-cleanup-needs-manifest-regeneration-2026-04-26.md` — closest cousin: the synthetic `agents/` UI grouping decision (same family of "fabricate UI from existing data" thinking, applied to a different storage layer).
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — counter-pattern on when *not* to widen the existing surface: when reuse means widening a security-sensitive boundary.
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — adjacent reasoning shape: "what does extraction/parallel build cost?" for code organization rather than UI.
- Auto-memory: `feedback_ui_fabrication_test` — the inverse rule (don't change storage to serve UI fabrication); together with this doc, the two triangulate when to build new vs. reuse.
- Auto-memory: `project_agents_folder_ui_only_decision` — the prior application of the synthetic-UI pattern in this codebase.
- PR #680 — plan-revision PR that captured the pivot rationale at the time it was made (canonical concrete example).
- Master plan: `docs/plans/2026-04-28-004-refactor-workspace-reviews-routing-and-removal-plan.md`.
- Origin requirements: `docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md`.
