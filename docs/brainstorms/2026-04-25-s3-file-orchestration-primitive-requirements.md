---
date: 2026-04-25
topic: s3-file-orchestration-primitive
---

# S3 File Orchestration Primitive

## Problem Frame

ThinkWork is moving toward fat folder agents: the folder is the agent, and S3 is the durable home for that folder. That creates a chance to make orchestration feel native instead of bolted on. Rather than introduce a heavyweight A2A protocol or workflow engine, ThinkWork can let explicit files in explicit folders declare work, lifecycle transitions, human review, and memory changes.

The core idea is simple: **folders hold context; event files declare intent; S3 changes wake work.** Agents and humans write inspectable files. The platform validates those writes, records a canonical operational event, and wakes the right folder-addressed agent context. Each wake is stateless: the runtime reads the run folder, acts, writes more files, and exits.

This is the cloud-native ThinkWork version of the "folder is the agent" daemon pattern described in Kieran Klaassen's Every article, adapted to S3, EventBridge, AgentCore, and multi-tenant audit requirements.

This document defines a primitive, not a workflow engine. v1 supports durable wakeups, async sub-agent work, HITL pause/resume, and memory-ingest triggers. It does not define DAGs, retries, workflow graphs, or in-runtime sleep.

---

## Actors

- A1. **Main agent**: the root folder-addressed agent context (`target: "."`) that can receive work, spawn async work, block, resume, and complete.
- A2. **Sub-agent**: any folder-addressed specialist target resolved through `AGENTS.md` routing, such as `expenses` or `support/escalation`.
- A3. **Human reviewer**: a paired human or operator who responds to HITL requests by editing a review file through admin/mobile.
- A4. **Dispatcher**: the platform component that observes S3 changes in eventful prefixes, validates intent, writes canonical events, and wakes AgentCore.
- A5. **Agent builder**: the inspection and HITL surface where operators can view runs, event history, review files, and errors as folder-native artifacts.
- A6. **Memory pipeline**: subscriber that ingests changed memory files and updates recall/wiki surfaces.

---

## Key Flows

- F1. **Work request wakes a target**
  - **Trigger:** A human, platform task, scheduler, or agent writes `work/inbox/{requestId}.md`.
  - **Actors:** A1 or A2, A4.
  - **Steps:** The dispatcher observes the inbox write, resolves the target folder, creates or records a run, copies or links the request into `work/runs/{runId}/request.md`, writes a canonical `work.requested` event, and wakes the target with `{target, runId}`.
  - **Outcome:** The target agent starts a stateless turn using files under `work/runs/{runId}/`.
  - **Covered by:** R1, R2, R3, R7.

- F2. **Human review pauses and resumes a run**
  - **Trigger:** An agent needs human input.
  - **Actors:** A1 or A2, A3, A4, A5.
  - **Steps:** The agent writes `review/{runId}.needs-human.md` and emits a `run.blocked` intent. The dispatcher records the blocked state and surfaces the review. A human edits the review file. The dispatcher observes the edit and wakes the same target at the same `runId`.
  - **Outcome:** HITL uses the same pause/resume contract as all other file-driven orchestration, with no runtime sleep.
  - **Covered by:** R4, R5, R8, R9.

- F3. **Async sub-agent resumes parent**
  - **Trigger:** A parent agent writes async work to a valid sub-agent target and blocks with `wait_for`.
  - **Actors:** A1, A2, A4.
  - **Steps:** The dispatcher wakes the sub-agent run. The parent exits in a blocked state. When the sub-agent writes `run.completed`, the dispatcher finds the waiting parent run and wakes the parent at its original `runId`.
  - **Outcome:** Parent and sub-agent coordinate through files and canonical events, not in-memory callbacks or a custom A2A protocol.
  - **Covered by:** R3, R5, R6, R9, R10.

- F4. **Memory file triggers ingest**
  - **Trigger:** An agent or platform writes under `memory/`.
  - **Actors:** A1 or A2, A4, A6.
  - **Steps:** The dispatcher canonicalizes a `memory.changed` event. The memory pipeline reads the changed file and performs ingest/compile work.
  - **Outcome:** Memory writers do not need to know downstream Lambda wiring; memory changes are just another file event.
  - **Covered by:** R1, R2, R11.

---

## Requirements

**Eventful folders**

- R1. v1 orchestration is opt-in by path. Only explicit eventful prefixes can wake work: `work/inbox/`, `events/intents/`, `work/runs/{runId}/events/`, `work/outbox/`, `review/`, `memory/`, and `errors/`. Ordinary workspace edits never trigger orchestration.
- R2. `work/` is the durable audit surface for orchestration. It contains `inbox/` for requests, `runs/{runId}/` for run state and outputs, and optional `outbox/` for result pointers to waiting parents or consumers.
- R3. Targets are folder-addressed. `target: "."` wakes the main agent; `target: "expenses"` wakes a sub-agent; nested targets use folder paths. Valid targets are resolved by the same `AGENTS.md` routing rules used by sub-agent delegation.

**Events and canonicalization**

- R4. Agents may write event intents, but the platform writes canonical events. Agent-authored JSON is never trusted infrastructure truth until the dispatcher validates it, stamps tenant/agent/run metadata, and records it.
- R5. v1 event vocabulary stays intentionally small: `work.requested`, `run.started`, `run.blocked`, `run.completed`, `run.failed`, `review.requested`, `memory.changed`, and `event.rejected`.
- R6. Canonical event rows live in the database as an operational index with pointers to S3 source and canonical object keys. S3 remains the inspectable artifact/audit surface; the database supports idempotency, lookup, waiters, dashboards, and retry handling.
- R7. Malformed, unsafe, or unauthorized event intents are rejected by writing a canonical `event.rejected` record. The original intent file is preserved for audit.

**Run lifecycle**

- R8. The runtime has no in-runtime sleep semantics in v1. A run pauses by writing files and events, exits, and later resumes when the dispatcher wakes the same target at the same `runId`.
- R9. HITL and async sub-agent resume share one contract: a run can end blocked, a later file/event can satisfy the block, and the dispatcher wakes the same `runId` with enough file context to continue.
- R10. Agents may create addressed work requests for themselves, valid sub-agents, and their parent. Cross-tenant writes and unrelated peer-root writes are rejected.
- R11. Memory writes under `memory/` emit `memory.changed` canonical events so memory ingest and wiki compile can subscribe to file changes instead of being hardwired into writers.

**Audit and UI**

- R12. `work/runs/{runId}/` is mostly append-only. Mutable files are explicit exceptions, such as `status.json` and human-editable review files. Corrections prefer superseding files/events over silent mutation.
- R13. The v1 agent builder exposes a read-only run/audit viewer plus a HITL editor. Operators can inspect work requests, runs, canonical events, results, errors, and edit/respond to review files. Full orchestration authoring is deferred.
- R14. Every wake must be explainable from a canonical event that points back to a source file. Operators can answer "why did this agent wake up?" from the folder view.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R6.** Given a human creates `work/inbox/reconcile-expenses.md` at the root agent folder, when the dispatcher sees the S3 write, it records `work.requested`, creates or assigns `runId`, points to the source file, and wakes `target: "."`.
- AE2. **Covers R3, R10.** Given the main agent writes a request to `expenses/work/inbox/audit-q2.md`, and `expenses` is enumerated in the root `AGENTS.md`, the dispatcher accepts the event and wakes the `expenses` sub-agent. Given the same agent writes to an unrelated root agent's inbox, the dispatcher rejects it.
- AE3. **Covers R7.** Given an agent writes malformed JSON to `events/intents/run-completed.json`, the dispatcher writes a canonical `event.rejected` record with the validation reason and leaves the malformed intent file untouched.
- AE4. **Covers R8, R9, R13.** Given an agent writes `review/run_123.needs-human.md` and blocks, when a human edits that review file in the agent builder, the dispatcher wakes the same target at `run_123`; the agent reads the run folder and continues.
- AE5. **Covers R9, R10.** Given a parent run blocks with `wait_for` pointing at a sub-agent run, when the sub-agent writes `run.completed`, the dispatcher finds the waiting parent in the database and wakes the parent at the original parent `runId`.
- AE6. **Covers R11.** Given an agent updates `memory/lessons.md`, the dispatcher records `memory.changed`; the memory pipeline ingests the changed file without the agent directly invoking memory or wiki Lambdas.
- AE7. **Covers R12, R14.** Given a run produces `result.md` and later needs a correction, the system writes `result.v2.md` and a superseding event rather than silently editing the prior result.

---

## Success Criteria

- Long-running agent work can pause for human input or sub-agent completion without holding runtime state or requiring a workflow engine.
- Operators can inspect the folder and understand current work, blocked runs, completed results, errors, and why each wake happened.
- Agents can coordinate asynchronously using file writes while the platform retains validation, tenant boundaries, idempotency, and auditability.
- Memory ingest becomes a subscriber to file changes rather than a custom chain known by each writer.
- `ce-plan` can proceed without inventing eventful prefixes, target semantics, canonicalization rules, run-resume behavior, HITL behavior, or the v1 agent-builder surface.

---

## Scope Boundaries

- Not building a workflow engine: no DAGs, no dependency graph UI, no compensation model, no workflow authoring language.
- Not adding in-runtime sleep or persistent Strands runtime state.
- Not treating every S3 write as eventful. Only explicit prefixes wake work.
- Not replacing synchronous `delegate_to_workspace`; async file wakeups complement it.
- Not covering compound-engineering brainstorm → plan → work session handoff in v1. That is a promising future application, but it has a different actor model and lifecycle.
- Not allowing arbitrary peer-to-peer root-agent writes in v1.
- Not making the agent builder a full orchestration console in v1; HITL editing and audit viewing are enough.

---

## Key Decisions

- **Dual surface: markdown work requests plus structured event intents.** Markdown keeps work readable and human-authored; JSON keeps lifecycle machine-validated.
- **Platform canonicalizes.** Agents can express intent, but the dispatcher owns canonical truth.
- **S3 artifacts plus DB pointers.** S3 is the audit surface; the database is the operational index.
- **Stateless wake/resume model.** Each wake reconstitutes from `work/runs/{runId}/`; no runtime sleep.
- **HITL and async sub-agent wait use one contract.** Both are blocked runs resumed by later file events.
- **Folder-addressed targets.** The same mental model powers sync delegation and async wakeups.
- **Primitive first.** v1 deliberately avoids workflow semantics so the foundation can ship and be used broadly.

---

## Dependencies / Assumptions

- Depends on the fat-folder sub-agent requirements in `docs/brainstorms/2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md`, especially `AGENTS.md` routing and folder-addressed sub-agents.
- Assumes S3 is the canonical workspace object store for agent folders.
- Assumes a dispatcher can validate target paths against the composed `AGENTS.md` routing table.
- Assumes the agent builder can render selected S3 folder paths and provide an editor for review files.
- Assumes EventBridge/S3 notification delivery is at-least-once, so planning must define idempotency keys and dedupe behavior.

---

## Outstanding Questions

### Resolve Before Planning

- (None.)

### Deferred to Planning

- [Affects R1][Technical] Exact EventBridge/S3 notification wiring and prefix filtering.
- [Affects R3, R10][Technical] Shared parser/location for `AGENTS.md` routing validation in dispatcher and runtime.
- [Affects R6][Technical] Minimal DB shape for canonical event pointers and waiter lookup.
- [Affects R6][Technical] Idempotency key derivation for at-least-once S3 event delivery.
- [Affects R8, R9][Technical] Exact runtime prompt/tool contract for "continue run from files."
- [Affects R11][Technical] How memory ingest avoids double-firing during migration from current Lambda chains.
- [Affects R13][Technical] Agent builder information architecture for run/audit viewer and review-file editing.

---

## Next Steps

Compare this primitive-first artifact with `docs/brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md`, then use the preferred shape as input to `/ce-plan`.
