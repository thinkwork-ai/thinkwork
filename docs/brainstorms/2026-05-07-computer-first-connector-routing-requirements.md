---
date: 2026-05-07
topic: computer-first-connector-routing
---

# Computer-First Connector Routing

## Problem Frame

The connector-platform roadmap originally assumed connector events dispatch directly to agent runs, deterministic routines, or hybrid routines. The newer ThinkWork Computer reframe changes the product ontology: a Computer is the durable per-user workplace and orchestrator, while Managed Agents are delegated workers.

That means the connector roadmap needs a course correction. External systems should not usually "hire an Agent" as the visible owner of work. They should surface work to a user's Computer. The Computer owns the thread, workspace continuity, credentials context, and orchestration decision; it may then delegate bounded work to a Managed Agent, routine, or hybrid workflow.

The immediate proof remains Linear-only. Broader Slack, GitHub, Google Workspace, and other connector types should be planned later using the same Computer-first routing model.

---

## Actors

- A1. Computer owner: owns the durable ThinkWork Computer that external connector events route to.
- A2. Tenant admin/operator: configures connector instances and binds each v0 connector explicitly to a Computer.
- A3. Connector runtime: ingests external events or poll results and creates durable connector execution provenance.
- A4. ThinkWork Computer runtime: owns the resulting work, records Computer tasks/events, creates the visible thread/run, and delegates when useful.
- A5. Managed Agent or routine: performs delegated work when the Computer chooses that substrate.
- A6. External system: Linear for the first proof; future systems such as Slack are out of scope for this addendum.

---

## Key Flows

- F1. Linear issue routes to a Computer
  - **Trigger:** A Linear issue matches the configured project/label gate.
  - **Actors:** A1, A2, A3, A4, A6
  - **Steps:** The connector runtime claims the Linear issue, records a connector execution, creates a Computer task/event for the explicitly bound Computer, and the Computer creates or updates the visible thread/run.
  - **Outcome:** The work is visible as Computer-owned work, with connector execution retained as provenance.
  - **Covered by:** R1, R2, R3, R5, R6

- F2. Computer delegates after connector pickup
  - **Trigger:** The Computer determines the Linear work should be handled by an existing Managed Agent, routine, or hybrid workflow.
  - **Actors:** A4, A5
  - **Steps:** The Computer prepares context, delegates bounded work, receives results back into the Computer-owned thread/workspace, and audit preserves the delegated worker.
  - **Outcome:** The Computer remains the owner of the work while the delegated substrate is visible as execution detail.
  - **Covered by:** R4, R7, R8

---

## Requirements

**Ownership and routing**

- R1. Connector events should route to Computers by default, not directly to Managed Agents.
- R2. The v0 Linear proof should use explicit connector-to-Computer binding; no automatic actor mapping or team queue routing is required yet.
- R3. The visible thread/run created from a connector event should be Computer-owned.
- R4. Managed Agents, routines, and hybrid workflows remain valid delegated execution substrates behind the Computer.

**Compatibility and advanced paths**

- R5. Existing direct connector targets such as Managed Agent, routine, and hybrid routine may remain as advanced/admin automation paths.
- R6. User-facing connector setup should default to Computer as the target and should not present "make this an Agent" as the happy path.
- R7. Connector execution records should represent provenance and operational state, not the durable owner of the work.
- R8. Delegation attribution must remain auditable when a Computer uses a Managed Agent or routine to complete connector-originated work.

**Proof scope**

- R9. The immediate proof remains Linear-only.
- R10. Slack-facing Computers, GitHub-facing Computers, and other connector types should be covered by follow-up connector plans rather than expanding this proof.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R7.** Given a Linear connector explicitly bound to Eric's Computer, when a matching Linear issue appears, ThinkWork records a connector execution and the resulting work appears as a Computer-owned thread/run.
- AE2. **Covers R4, R8.** Given the Computer delegates the Linear issue to a Managed Agent, when the delegated worker produces a result, the Computer-owned thread shows the result and the audit trail records the delegated worker.
- AE3. **Covers R5, R6.** Given an admin configures a connector through the normal UI, when choosing the target, Computer is the default path while direct Managed Agent/routine/hybrid targets are treated as advanced options.
- AE4. **Covers R9, R10.** Given this addendum is used for the next implementation plan, when planning the immediate PR sequence, it does not add Slack or another connector type to the Linear proof.

---

## Success Criteria

- The connector roadmap no longer treats direct Agent dispatch as the default owner model.
- A downstream plan can implement "Linear issue -> connector execution -> Computer task/event -> Computer-owned thread/run" without inventing ownership semantics.
- Future connector plans can reuse the same Computer-first model for Slack or other external systems without changing the Linear proof scope.

---

## Scope Boundaries

- No additional connector types in the immediate proof.
- No automatic Slack/Linear/GitHub actor-to-Computer matching in v0.
- No tenant/team unassigned queue in v0.
- No removal of advanced direct Managed Agent, routine, or hybrid routine targets yet.
- No rewrite of the full connector-platform roadmap; this is a course-correction addendum.

---

## Key Decisions

- **Computer is the default connector target:** This matches the product ontology introduced by `docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md`.
- **Explicit connector-to-Computer binding for v0:** This gives the Linear proof a crisp route and avoids premature routing intelligence.
- **Direct targets are demoted, not deleted:** Advanced automation paths remain possible, but the normal product story becomes external system -> Computer -> delegated work.
- **Linear proof stays narrow:** The addendum corrects ownership without expanding connector breadth.

---

## Dependencies / Assumptions

- Assumes Computers remain one-per-user for v1.
- Assumes Computer task/event tables and Computer-owned runtime surfaces are the right durable queue/audit layer for inbound connector work.
- Assumes Managed Agents remain available as delegated workers after the Computer reframe.
- Assumes future Slack-facing Computers should use the connector pattern, but will be planned separately.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- **[Affects R2, R3][Technical]** Decide the minimal schema/API change needed to represent Computer as a connector target while preserving existing direct target compatibility.
- **[Affects R3, R7][Technical]** Decide how connector executions, Computer tasks/events, and threads reference each other without creating duplicate sources of truth.
- **[Affects R4, R8][Technical]** Define the first delegation handoff from Computer-owned work to Managed Agent or routine execution.
- **[Affects R6][UX]** Decide how the admin UI exposes advanced direct targets without making them look like the recommended path.

---

## Next Steps

-> `/ce-plan` for a Computer-first connector-routing child plan.
