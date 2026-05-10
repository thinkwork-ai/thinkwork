---
date: 2026-05-10
topic: computer-runbooks-foundation
references:
  - https://github.com/coleam00/Archon
  - https://elements.ai-sdk.dev/components/confirmation
  - https://elements.ai-sdk.dev/components/queue
  - https://strandsagents.com/docs/user-guide/concepts/multi-agent/agents-as-tools/
  - https://strandsagents.com/docs/user-guide/concepts/multi-agent/workflow/
---

# Computer Runbooks Foundation

## Problem Frame

Computer needs a proper pattern for substantial, repeatable work. The current Artifact Builder path proves that skill references can steer generated dashboards and apps, but that pattern is too narrow for the number and variety of runbooks ThinkWork plans to publish. This is not primarily a bug fix; it is a foundation feature for making Computer work flexible, inspectable, and repeatable across many application types.

Runbooks should become the standard execution contract for substantial Computer work, not just artifact generation. A CRM dashboard, map artifact, research dashboard, meeting-prep app, account review, or future business workflow should all be expressible as a published runbook. The user should not need to know runbook names: Computer can route to a published runbook when intent is clear, ask for confirmation when it auto-selects one, and then show live progress through a visible task queue.

The core architectural boundary is: **ThinkWork runbooks are the product contract; Strands is an execution engine.** Runbooks describe user-facing intent, inputs, phases, expected outputs, confirmation behavior, progress semantics, and future-safe override boundaries. At runtime, those definitions may compile into a sequential Computer loop, Strands agents-as-tools, the Strands workflow tool, or a later state-machine-backed runner.

---

## Actors

- A1. End user: asks Computer for substantial work and approves auto-selected runbooks before execution.
- A2. ThinkWork Computer: routes requests to runbooks, expands runbook phases into concrete tasks, executes the work, and reports progress.
- A3. ThinkWork runbook author: publishes versioned YAML and Markdown runbook definitions in the repo.
- A4. Future tenant operator: eventually modifies safe runbook fields, but v1 only needs a source shape that will not block that path.
- A5. Strands runtime: executes runbook tasks through the main Computer agent, specialist agents-as-tools, or workflow-like execution primitives.
- A6. Computer UI: renders auto-selection confirmation and live task progress.

---

## Key Flows

- F1. Auto-selected runbook with confirmation
  - **Trigger:** A1 asks Computer to do substantial work and Computer has a high-confidence runbook match.
  - **Actors:** A1, A2, A6
  - **Steps:** Computer identifies the candidate runbook from published triggers; renders a Confirmation card with runbook name, description, expected outputs, likely tools/sources, and phase summary; waits for A1 approval; on approval, starts the runbook; on rejection, falls back to normal chat or offers alternatives.
  - **Outcome:** Auto-selected structured work never begins invisibly or surprisingly.
  - **Covered by:** R1, R2, R3, R8

- F2. Explicit runbook invocation
  - **Trigger:** A1 explicitly asks to run a named runbook.
  - **Actors:** A1, A2, A6
  - **Steps:** Computer resolves the named runbook, starts without an extra confirmation gate, expands phases into tasks, and shows the Queue view as execution begins.
  - **Outcome:** Users who know the runbook they want are not forced through redundant approval.
  - **Covered by:** R2, R4, R8

- F3. Visible runbook execution
  - **Trigger:** A runbook has been approved or explicitly invoked.
  - **Actors:** A2, A5, A6
  - **Steps:** Computer expands declared phases into concrete user-meaningful tasks; every task maps back to one declared runbook phase; tasks execute sequentially in v1 while preserving a dependency-ready model; Queue/Task UI shows pending, running, completed, failed, and skipped state; task details can expose evidence or tool-call summaries without making raw tool calls the primary progress unit.
  - **Outcome:** The user can see what Computer is doing, what has completed, and what remains.
  - **Covered by:** R5, R6, R7, R8, R12

- F4. Runbook execution through Strands capabilities
  - **Trigger:** A phase or expanded task requires specialist work.
  - **Actors:** A2, A5
  - **Steps:** The runbook names a capability role rather than a concrete agent; the runtime maps that role to the main Computer agent, a Strands agent-as-tool, a workflow task, or a later state-machine-backed runner; task outputs flow into later tasks through an explicit execution context.
  - **Outcome:** Runbook definitions stay stable while the execution backend can evolve.
  - **Covered by:** R9, R10, R11, R12

---

## Requirements

**Runbook source and publishing**

- R1. V1 runbooks are ThinkWork-published YAML and Markdown files, stored as versioned repo artifacts and suitable for review, diffing, and release.
- R2. A runbook definition must include catalog metadata, trigger examples or routing hints, required/optional inputs, declared phases, expected outputs, and user-facing confirmation/progress copy.
- R3. V1 does not include tenant-authored or tenant-edited runbooks, but the definition shape must reserve clear boundaries for future operator-overridable fields.

**Routing and approval**

- R4. Computer may auto-select a runbook when intent confidence is high, but auto-selected runbooks require user confirmation before execution.
- R5. Explicit named runbook invocation starts directly without an additional confirmation gate.
- R6. If no runbook matches confidently, Computer falls back to a visible ad hoc plan/task list rather than pretending a published runbook applies.

**Phases, tasks, and progress**

- R7. Runbook YAML declares durable phases; phase Markdown gives execution guidance.
- R8. After approval, Computer expands phases into concrete tasks that are meaningful to the user. Every expanded task must reference a declared runbook phase.
- R9. The primary progress UI uses AI Elements Queue/Task-style presentation grouped by runbook phase. Raw tool calls may appear as details or evidence, but not as the main progress list.
- R10. V1 executes runbook phases logically sequentially, while the task model preserves dependency fields needed for later parallel or state-machine execution.

**Strands execution model**

- R11. Runbooks are the source of truth; Strands agents-as-tools, the Strands workflow tool, and any future state-machine runner are compilation/execution targets.
- R12. Runbook tasks declare capability roles rather than concrete specialist-agent names. The runtime maps capabilities to the main Computer agent, specialist agents-as-tools, or workflow tasks.
- R13. The execution context must support passing task outputs forward so later tasks can depend on prior results without redoing work.

**Initial runbook coverage**

- R14. Existing Artifact Builder dashboard/app behavior should become one runbook family rather than a special hidden skill path.
- R15. V1 should support all substantial Computer work as the runbook target domain, not only dashboards, maps, or app artifacts.

---

## Acceptance Examples

- AE1. **Covers R4, R9.** Given a user asks "build me a map of supplier risk" and Computer confidently matches a published map-artifact runbook, when it responds, then it shows a Confirmation card before starting and does not begin execution until the user approves.
- AE2. **Covers R5, R8.** Given a user says "run the CRM dashboard runbook for LastMile," when Computer resolves the named runbook, then it starts directly and shows the expanded Queue tasks grouped under declared phases.
- AE3. **Covers R6.** Given a user asks for novel work that no published runbook confidently matches, when Computer responds, then it creates a visible ad hoc task plan rather than silently forcing the request into the closest runbook.
- AE4. **Covers R7, R8, R10.** Given a runbook declares phases `discover`, `analyze`, and `produce`, when execution starts, then all generated tasks map to one of those phases and execute in a predictable v1 sequence.
- AE5. **Covers R11, R12, R13.** Given a runbook task declares capability `artifact_build`, when the runtime executes it, then the runbook remains stable even if implementation maps that capability to the main Computer agent now and a Strands agent-as-tool later.

---

## Success Criteria

- ThinkWork can publish multiple runbooks for different substantial Computer tasks without adding bespoke hidden skill paths for each one.
- Users see when Computer has selected a runbook, can approve auto-selected work, and can track execution through a clear phase/task queue.
- The first artifact-generation runbooks become easier to extend because the recipe lives inside a broader runbook pattern rather than inside a one-off skill reference.
- Planning can proceed without inventing the product boundary between runbooks, skill prompts, Strands workflows, AI Elements Confirmation, and Queue progress.

---

## Scope Boundaries

- V1 runbooks are ThinkWork-authored only. Tenant authoring and operator editing are deferred.
- V1 phases execute sequentially. Parallel execution, fan-in/fan-out, and state-machine execution are deferred but should be supported by the definition model.
- V1 should not make Strands workflow definitions the product source of truth.
- V1 should not require users to know runbook names for common work.
- V1 should not show raw internal tool calls as the main task queue.
- V1 does not replace all existing routines or scheduled-job infrastructure.
- V1 does not require a visual runbook builder.
- V1 does not turn runbooks into a generic BI, app-builder, or workflow-automation product independent of Computer.

---

## Key Decisions

- **Runbooks cover all substantial Computer work:** The target domain is broader than artifact creation.
- **Intent-routed with confirmation:** Computer may choose a runbook automatically, but only starts after user approval when the choice was inferred.
- **Explicit invocation starts directly:** Users who name a runbook do not need a second approval step.
- **YAML and Markdown source:** Runbooks are authored as portable, reviewable files rather than primarily as database rows or workspace skill folders.
- **Phases first, tasks expanded at runtime:** YAML declares durable phases; Computer expands those phases into concrete tasks after approval.
- **Sequential v1, parallel-ready model:** Execution stays predictable while the definition can evolve toward dependencies and state-machine execution.
- **Runbook product contract, Strands execution target:** Strands agents-as-tools and workflow primitives shape execution but do not become the user-facing runbook definition.
- **Capability roles over named agents:** Runbooks name capabilities so the runtime can evolve the underlying specialist mapping.

---

## Dependencies / Assumptions

- Computer already has task and event persistence that can inform a runbook progress model, but planning must decide whether to extend existing `computer_tasks` or introduce runbook-specific run/task records.
- The Computer UI already has AI Elements adoption work underway, including Artifact and related primitives; planning should align Confirmation and Queue integration with that direction.
- Current Artifact Builder defaults and CRM dashboard recipe are useful seed material for the first artifact-generation runbook family.
- Strands agents-as-tools and workflow concepts are suitable execution references, but the exact SDK/runtime integration must be validated during planning.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R1, R2][Technical] Decide the exact runbook directory/package layout and how runbook files are discovered, validated, and seeded into catalog surfaces.
- [Affects R4, R6][Technical] Define intent-routing confidence thresholds, ambiguity handling, and how multiple matching runbooks are presented.
- [Affects R9][Technical] Decide whether Queue state is derived from existing `computer_tasks`/`computer_events` or from new runbook run/task tables.
- [Affects R11, R12][Technical] Define the capability-role registry and runtime mapping to the main Computer agent, Strands agents-as-tools, or workflow tasks.
- [Affects R10, R13][Technical] Decide the v1 execution adapter: simple sequential runner, Strands workflow tool compilation, or an adapter that can switch between both.
- [Affects R14][Technical] Plan the migration path from `skills/artifact-builder/*` into the first published artifact runbooks without breaking existing Computer behavior.

---

## Next Steps

-> /ce-plan for structured implementation planning.
