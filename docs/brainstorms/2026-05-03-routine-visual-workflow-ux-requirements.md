---
date: 2026-05-03
topic: routine-visual-workflow-ux
---

# Routine Visual Workflow UX

## Problem Frame

The shipped admin Routine MVP proves that recipe-backed Step Functions routines can be created, edited, saved, tested, and inspected, but the current UX does not make the workflow understandable. It uses a permanent recipe list, list-based workflow editing, inline step detail, and nested scrolling surfaces. That turns even a two-step routine into a cramped form dump, and it gives operators no durable mental model for branching logic.

Routines are meant to feel like transparent AWS Step Functions workflows expressed through ThinkWork-owned recipe blocks. The UI should therefore lead with a graphical workflow surface: operators see the whole routine, click a node or branch to inspect detail, and use guided actions to add or configure steps. Recipe selection should appear only when the user is adding a step, not occupy the screen at rest.

This is a follow-up to the shipped admin Routine MVP, not a rewrite of the Routines rebuild requirements. The relevant existing anchors are `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`, `docs/plans/2026-05-02-007-feat-routine-graph-editor-plan.md`, and `docs/plans/2026-05-02-008-feat-routine-builder-ux-polish-plan.md`.

---

## Actors

- A1. Tenant operator: authors and edits routines in admin, tests saved versions, and needs to understand what a routine will do before publishing.
- A2. Run investigator: opens a routine execution and needs to answer what happened, which branch ran, and what a selected step produced.
- A3. ThinkWork planner/implementer: turns this requirements document into a scoped plan without reinventing the product model.

---

## Key Flows

- F1. Visual routine editing
  - **Trigger:** A tenant operator opens a routine definition.
  - **Actors:** A1.
  - **Steps:** The page renders a full workflow graph from the current ASL topology. The operator clicks a node or branch. A side sheet shows editable recipe/config details and guided graph actions. The operator chooses `Add step after` or a branch-aware action, searches recipes in an add-step flow, configures the new step, and saves the routine.
  - **Outcome:** The operator understands the whole workflow while editing a specific part, and the saved routine publishes through the existing version pipeline.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R9.

- F2. Branch-aware workflow comprehension
  - **Trigger:** A routine contains `Choice`, `Map`, or `Parallel` structure.
  - **Actors:** A1, A2.
  - **Steps:** The graph renders control-flow states as first-class visual structures. Choice edges show readable condition/default labels. Map and Parallel sections show grouped or nested workflow regions without collapsing the whole routine into a linear list. Clicking a branch or group exposes focused details without hiding the surrounding topology.
  - **Outcome:** Branching is visible and understandable before the user edits or inspects any single node.
  - **Covered by:** R1, R3, R4, R7, R8.

- F3. Execution inspection on the same graph
  - **Trigger:** A run investigator opens a routine execution detail page.
  - **Actors:** A2.
  - **Steps:** The same graph component renders the historical ASL version that ran. Execution status, selected path, step events, output/error, retry count, and approval state decorate the graph. Clicking a node opens the side sheet in inspection mode instead of authoring mode.
  - **Outcome:** Authoring and run inspection share one mental model; the run page answers "what happened here?" without requiring CloudWatch, Step Functions console, or raw event plumbing.
  - **Covered by:** R1, R2, R5, R8, R10.

---

## Requirements

**Graph surface**

- R1. Routine authoring and routine execution detail must use a shared graph component so operators learn one workflow representation across edit and inspect modes.
- R2. The graph must be the primary surface in the Definition view; step detail must move into a side sheet or equivalent inspector instead of expanding inline inside the workflow surface.
- R3. The graph topology must be ASL-first: `StartAt`, `States`, `Next`, `End`, `Choices`, `Default`, `Catch`, `Map`, and `Parallel` define nodes, edges, groups, and branches.
- R4. ThinkWork metadata must decorate, not replace, ASL topology. Recipe ids, recipe display names, step labels, config state, validation issues, dirty state, and execution status overlay the ASL-derived graph.

**Branching and comprehension**

- R5. Branching must be treated as first-class in the first visual pass. `Choice`, `Map`, and `Parallel` workflows cannot be flattened into an ordered step list.
- R6. Choice branches must show readable edge labels for conditions and default paths. Generic labels such as "Choice 1" are insufficient when the condition can be summarized.
- R7. Map and Parallel structures must preserve nested context while keeping the parent routine navigable. The UI may use grouped regions, expandable regions, or another graph-native representation, but the user must not lose sight of the parent flow.
- R8. Run detail must visibly distinguish pending, running, succeeded, failed, timed-out, cancelled, and awaiting-approval states, including which branch executed when that can be inferred from step events/history.

**Guided editing**

- R9. Graph editing must be guided, not freehand. Users may add a step after a node, add/edit a branch through a controlled action, remove a step, edit a condition, or configure a selected node, but they should not draw arbitrary edges between handles in this pass.
- R10. The recipe catalog must leave the default layout. Adding a step opens a searchable add-step flow, command palette, modal, or sheet that shows applicable recipes only when needed.
- R11. The selected node inspector must expose the same recipe-backed config fields the current editor supports, including multiline code/body/SQL-like fields, required markers, validation errors, and read-only fields.
- R12. Save/test safety must survive the graph redesign: unsaved graph or config changes are obvious, Save is disabled when there are blocking validation errors, and Test Routine runs only the saved/published workflow.

**Operational fit**

- R13. The visual graph must avoid nested scrolling inside the main page. The page may have one primary viewport and one inspector, but not independent scroll regions competing for the same routine content.
- R14. The UX must remain a ThinkWork routine editor, not an AWS console clone. AWS Step Functions concepts should be visible where they clarify behavior, while recipe names and business labels remain the primary operator language.
- R15. The first release must preserve the existing server-authoritative publish/validation model. The UI can guide edits locally, but ASL generation and validation still complete through the existing routine version pipeline.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R10, R11.** Given an existing two-step Austin weather routine, when the operator opens the Definition view, the workflow graph occupies the primary surface, no recipe list is permanently visible, clicking "Fetch Austin weather" opens its config in a side sheet, and adding a step opens a searchable recipe picker.
- AE2. **Covers R3, R5, R6, R9.** Given a routine with a `Choice` state that routes approved and rejected cases to different next steps, when the graph renders, the Choice node has distinct labeled outgoing edges and the operator edits branch behavior through guided controls rather than drawing a new edge manually.
- AE3. **Covers R5, R7.** Given a routine with a `Parallel` or `Map` state, when the graph renders, nested branches or iterator steps appear as grouped graph regions and the parent workflow remains visible enough to understand where the group starts and rejoins.
- AE4. **Covers R1, R4, R8.** Given a routine execution that failed in one branch after an approval step, when the investigator opens run detail, the same graph component renders the historical ASL version, highlights the executed path, marks the approval and failed nodes, and clicking the failed node shows output/error details.
- AE5. **Covers R12, R15.** Given an operator adds a step through the graph and leaves a required field empty, when they try to save or test, the graph/inspector shows the validation issue, Save is blocked until fixed, and Test Routine remains tied to the last saved version.

---

## Success Criteria

- Operators can understand a routine's structure from the graph before opening any step details.
- Branching routines no longer feel like broken linear lists; Choice, Map, and Parallel behavior is visible enough for authoring and run inspection.
- The permanent recipe pane and nested workflow/detail scrolling are removed from the routine Definition experience.
- Authoring and execution detail share one visual language, reducing the gap between "what I configured" and "what actually ran."
- A planner can produce an implementation plan without deciding whether this is a graph, a list, a canvas editor, or a Step Functions console clone.

---

## Scope Boundaries

- Freehand drag-to-connect edge authoring is out of scope for this pass.
- A raw ASL editor is out of scope.
- Embedding AWS Workflow Studio itself is out of scope unless later research discovers a supported embeddable product surface.
- Replacing the server-side ASL generator, recipe catalog, validator, or publish pipeline is out of scope.
- Mobile routine authoring parity is out of scope for this pass, though the shared graph model should not make mobile parity harder later.
- New schedule/webhook trigger editing remains outside Routine definition editing.
- Pause-and-edit of in-flight Step Functions executions remains out of scope.
- Full visual diff/rollback between routine versions is out of scope.

---

## Key Decisions

- Use a visualizer-first model: the graph is the primary comprehension surface, while editing remains guided and constrained.
- Use one shared graph component for authoring and run detail so the operator does not learn two representations of the same workflow.
- Use ASL as the graph topology source of truth because it captures real branching, error paths, and nested flow better than the current ordered recipe-step list.
- Overlay recipe and execution metadata on ASL-derived nodes rather than synthesizing topology from recipe metadata.
- Support branch-aware rendering from the first pass; sequence-only would recreate the current mismatch as soon as real routines branch.
- Replace the permanent recipe palette with an add-step flow so recipes appear at the moment of intent instead of consuming the routine comprehension surface.
- Borrow ideas from `asl-viewer` only selectively. Its ASL parsing, edge derivation, artificial start/end nodes, and grouping concepts are useful references, but direct adoption is risky because it uses legacy React Flow packages and does not understand ThinkWork recipe/config/run metadata.

---

## Dependencies / Assumptions

- Current routine versions already persist ASL JSON, markdown summary, and step manifest data through `RoutineAslVersion`.
- Current execution detail already resolves historical ASL version metadata for a run; the graph can use this as the inspection source.
- Current admin definition editing already exposes recipe-backed config fields and update mutation inputs; the visual redesign should reuse that behavioral contract.
- React Flow is a plausible rendering substrate, but the exact package and layout implementation belong in planning.
- `asl-viewer` is Apache-2.0 and can be used as reference material; copying adapted code would require preserving the appropriate attribution/license obligations.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3, R7][Technical] Determine the exact ASL feature coverage needed for the first pass, especially modern Map shapes such as `ItemProcessor` versus older `Iterator`.
- [Affects R3, R6][Technical] Decide whether to build a custom ASL-to-graph adapter from scratch, adapt small pieces from `asl-viewer`, or use a library only for parsing/layout reference.
- [Affects R7, R13][Technical] Choose the layout algorithm and responsive behavior for large branching routines without reintroducing nested scroll regions.
- [Affects R8][Technical] Decide how much execution path highlighting can be inferred from `routine_step_events` alone versus Step Functions execution history.
- [Affects R9, R15][Technical] Define the mutation/update model for branch edits so guided graph operations still publish through the existing recipe-backed ASL pipeline.

---

## Next Steps

-> /ce-plan for structured implementation planning.
