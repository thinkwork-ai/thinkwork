---
date: 2026-05-27
topic: agentic-os-folder-native-goals
---

# Agentic OS Folder-Native Goals

## Problem Frame

ThinkWork has the right substrate for an agentic operating system: one tenant
platform agent, Spaces as contextual workrooms, user-scoped context, Threads as
durable collaboration records, S3-backed workspace files, and Company Brain.
But users and builders still lack a crisp decision grammar for how work should
run. The current Customer Onboarding Space proves the opportunity: an agent can
coordinate a team around a checklist, progress panel, and Thread, but the
workflow is still mostly "checklist plus agent narration" rather than a
portable execution contract.

ThinkWork should introduce folder-native Goals as the structure that turns
Threads into accountable agentic workflows. A Goal is the outcome contract for a
unit of work inside a Space. It is defined by portable markdown files and
executed through ThinkWork's governed runtime. The model should honor the
"Folder Is the Agent" / Interpretable Context Methodology idea: folders,
markdown context, stage outputs, and review files are not incidental storage;
they are the agent architecture.

The North Star is:

```text
Agent acts in a Space on behalf of a User toward a Goal.
```

---

## Actors

- A1. Tenant operator: configures Spaces, Goal templates, tools, memory,
  review policy, and Space-owned operating context.
- A2. End user: starts or participates in Threads and needs clear guidance for
  getting the best results from ThinkWork.
- A3. Goal owner: is accountable for a promoted Goal's outcome, progress, and
  completion readiness.
- A4. Coordinator agent: reads Goal folders, drives progress, asks for human
  input, records decisions, prepares handoffs, and recommends completion.
- A5. Product/engineering team: uses the model to decide what belongs in Agent,
  Space, User, Thread, Goal, markdown, Aurora, and Company Brain.
- A6. Company Brain: distills durable learning from completed Goal folders,
  decisions, handoffs, artifacts, and final outcomes.
- A7. External/local agent runner: a future Codex, Claude Code, or other local
  agent environment that can consume exported ThinkWork folders with graceful
  degradation.

---

## Key Flows

- F1. Operator defines a Space-owned Goal template
  - **Trigger:** A tenant operator configures a workflow such as Customer
    Onboarding.
  - **Actors:** A1, A4
  - **Steps:** The operator authors a Goal template inside the Space as
    markdown. The template defines the outcome contract, mode, expected
    progress model, review policy, optional stages, handoff expectations, and
    artifact conventions. ThinkWork can execute the template, but the files
    remain understandable outside ThinkWork.
  - **Outcome:** The Space carries a portable operating pattern that can create
    many Goal instances.
  - **Covered by:** R1, R2, R3, R4, R13, R14

- F2. Thread intent is promoted into a Goal
  - **Trigger:** A user starts structured work, or a Space workflow creates a
    Thread from a Goal template.
  - **Actors:** A2, A3, A4
  - **Steps:** ThinkWork creates or promotes the Thread's intent into a Goal
    with an explicit outcome, owner, mode, progress model, completion rule, and
    review policy. It creates a thread-owned Goal folder with live execution
    files such as `GOAL.md`, `PROGRESS.md`, `DECISIONS.md`, `ARTIFACTS.md`,
    `HANDOFFS.md`, and optional template-defined `stages/`.
  - **Outcome:** The Thread becomes the collaboration record for a structured
    Goal, while the Goal folder becomes the portable current-state and
    execution contract.
  - **Covered by:** R5, R6, R7, R8, R9, R10

- F3. Agent drives the Goal through progress, decisions, and handoffs
  - **Trigger:** A user message, automation, checklist update, or stage
    transition wakes the coordinator agent.
  - **Actors:** A3, A4, A6
  - **Steps:** The agent reads the Space context, User context, Thread history,
    and Goal folder. It updates structured workflow state through ThinkWork
    tools, refreshes agent-readable markdown state, asks humans for missing
    information, records decisions and handoffs, and prepares artifacts or
    artifact summaries as work moves between stages.
  - **Outcome:** The team gets accountable workflow execution, not just chat
    suggestions. Company Brain receives higher-quality source material than raw
    transcript inference alone.
  - **Covered by:** R8, R9, R10, R11, R12, R15, R16

- F4. Completed Goal compounds into reusable learning
  - **Trigger:** A Goal reaches its completion rule and review policy.
  - **Actors:** A3, A4, A6
  - **Steps:** ThinkWork finalizes the Goal folder, preserving the outcome,
    progress, decisions, handoffs, artifacts, and final review. Company Brain
    can distill these files into durable knowledge, process improvements,
    customer/account memory, and future template refinements.
  - **Outcome:** Finished work leaves behind both an audit-friendly case file
    and reusable operating knowledge.
  - **Covered by:** R12, R15, R16, R17

---

## Requirements

**Product model**

- R1. ThinkWork must define the canonical turn model as: Agent acts in a Space
  on behalf of a User toward a Goal.
- R2. ThinkWork must distinguish Thread intent from promoted Goals: every Thread
  has intent, but only structured work becomes a full Goal with lifecycle,
  progress, ownership, completion, and review semantics.
- R3. Delegate vs Collaborate must become a first-class mode on Goals. Delegate
  means ThinkWork drives work toward completion with collaboration checkpoints;
  Collaborate means the user and agent work live in the Thread.
- R4. ThinkWork must teach a maturity ladder from chat to durable operating
  system: ask in a Space, use context/tools, promote repeated work into Goals,
  add reusable templates, then compound completed work into Company Brain.

**Goal contract**

- R5. A promoted Goal must have a minimum contract: outcome, owner, mode,
  progress model, completion rule, and review policy.
- R6. Review policy must support human-confirmed completion for team workflows,
  while allowing low-risk Goals to declare no required review.
- R7. The Customer Onboarding Space is the reference proving slice: its current
  checklist becomes one progress model inside a broader Goal contract rather
  than the whole workflow meaning.
- R8. Goal templates must be Space-owned markdown by default. They must not be
  database-first workflow definitions with markdown as a later export artifact.

**Folder-native execution**

- R9. A promoted Goal must create a thread-owned folder containing portable live
  execution files. The required v1 set is `GOAL.md`, `PROGRESS.md`,
  `DECISIONS.md`, `ARTIFACTS.md`, and `HANDOFFS.md`.
- R10. Goal templates decide whether instances are flat or staged. Staged Goals
  may use numbered folders for workflow stages; simple Goals should not be
  forced into a stage pipeline.
- R11. Markdown files must be runnable outside ThinkWork with graceful
  degradation. A copied Space + Agent + User + Goal folder should give a local
  Codex or Claude Code session enough context to continue the work even when
  ThinkWork-only tools are unavailable.
- R12. S3 is the file substrate for v1 Goal folders and rendered operational
  context. It remains the portable, inspectable file layer; Aurora remains the
  indexed execution ledger.

**State and source of truth**

- R13. Aurora must remain canonical for structured workflow state: task status,
  owners, lifecycle, permissions, review decisions, timestamps, and artifact
  index rows.
- R14. Markdown must be canonical for narrative workflow state: Goal contract,
  decision rationale, handoff notes, artifact summaries, stage instructions,
  and agent-readable current briefing.
- R15. `PROGRESS.md` must remain a rendered operational briefing for agent
  turns, not a second source of truth for structured task state.
- R16. `DECISIONS.md`, `HANDOFFS.md`, and `ARTIFACTS.md` must be designed as
  high-signal inputs to Company Brain, so completed Goals compound into better
  reusable knowledge than transcript-only memory.

**Doctrine and audience guidance**

- R17. The first durable guidance must serve one canonical model with operator
  guidance first, end-user best practices second, and product/engineering
  placement rules third.
- R18. Docs should make export-readiness visible as doctrine: ThinkWork Spaces,
  Users, Agents, and Goals are folder-native and portable in principle, without
  promising export UI in v1.

---

## Acceptance Examples

- AE1. **Covers R5, R7, R9, R13, R15.** Given a user starts Customer
  Onboarding for Texas Oil and Gas, when ThinkWork creates the structured work,
  then the Thread has a Goal folder with `GOAL.md` and `PROGRESS.md`; checklist
  rows remain structured state, and `PROGRESS.md` summarizes them for the agent.
- AE2. **Covers R8, R10, R11.** Given an operator authors a Customer Onboarding
  Goal template in a Space, when the files are copied outside ThinkWork, then a
  local agent can read the template and understand the outcome, stages if any,
  required context, expected artifacts, and graceful fallbacks for unavailable
  ThinkWork tools.
- AE3. **Covers R3, R5, R6.** Given a Goal declares mode "Delegate with
  collaboration checkpoints" and human final review required, when all required
  progress rows are complete, then the coordinator recommends completion and
  asks for review rather than silently closing the work.
- AE4. **Covers R14, R16.** Given a Goal produces a pricing decision and a
  customer handoff artifact, when the Goal completes, then `DECISIONS.md`,
  `HANDOFFS.md`, and `ARTIFACTS.md` preserve the rationale and outputs in a
  form Company Brain can later distill.
- AE5. **Covers R1, R2, R4, R17.** Given a new operator reads the Agentic OS
  guidance, when they decide whether to create a Space, a Goal, an automation,
  or a folder specialist, then the docs give placement rules without requiring
  Eric or engineering to re-explain the architecture.

---

## Success Criteria

- Operators can explain ThinkWork as: "Agents act in Spaces on behalf of Users
  toward Goals."
- Customer Onboarding evolves from a checklist-oriented proof into the reference
  pattern for folder-native Goal execution.
- A downstream planner can implement Goal execution without re-deciding whether
  templates live in markdown, whether S3 is the file substrate, what state lives
  in Aurora, or what Thread folders should contain.
- A future export feature could be added without re-architecting Goal, Space,
  Agent, or User context storage.
- Completed Goals become better Company Brain source material than raw chat
  transcripts alone.

---

## Scope Boundaries

### Deferred for later

- Export UI or CLI for Space + Agent + User + Goal folders.
- General visual workflow builders, drag-and-drop stage editors, or full project
  management UI.
- Automatic template improvement from completed Goals.
- Cross-tool local runner adapters for Codex, Claude Code, or other agent
  environments.
- Rich artifact lifecycle management beyond portable summaries and indexed
  references.
- General task-system replacement features such as subtasks, estimates,
  dependency graphs, and portfolio reporting.

### Outside this product's identity

- ThinkWork is not trying to be a generic project management system. Goals are
  agentic outcome contracts, not Jira/Asana clones.
- ThinkWork is not trying to win as a blank ad hoc chat box. Codex-like tools
  will keep improving there; ThinkWork should win on accountable team workflow
  execution.
- ThinkWork should not make markdown a decorative export of a hidden workflow
  engine. The folder-native operating substrate is the product architecture.
- ThinkWork should not parse markdown as the authority for critical structured
  state when Aurora already owns lifecycle, permissions, review, task, and audit
  indexing.

---

## Key Decisions

- **Goal is the execution contract:** A checklist is only one progress model; a
  Goal carries outcome, owner, mode, progress, completion, and review.
- **Space-owned templates:** Reusable Goal templates live in Space markdown so
  workflow doctrine is portable and local to the workroom.
- **Thread-owned live folders:** Promoted Goals create thread folders that hold
  current execution context, decisions, artifacts, handoffs, and optional stages.
- **S3 for files, Aurora for ledger:** S3 fits the folder-native model and keeps
  files portable; Aurora indexes and enforces structured workflow state.
- **Markdown is canonical for narrative state:** Decisions, handoffs, artifact
  summaries, and Goal contracts should not be trapped only in rows or chat
  history.
- **Export-readiness is doctrine, not v1 scope:** The architecture should make
  export quick to add later, but v1 does not need an export button.
- **Customer Onboarding is the reference slice:** Its existing `PROGRESS.md`,
  checklist, Thread, and coordinator behavior provide the proving ground for
  folder-native Goals.

---

## Dependencies / Assumptions

- Existing Spaces/runtime docs already establish the substrate:
  `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md`,
  `docs/src/content/docs/concepts/agents.mdx`, and
  `docs/src/content/docs/concepts/spaces.mdx`.
- Existing Customer Onboarding work provides the first proof:
  `docs/brainstorms/2026-05-19-spaces-customer-onboarding-v1-requirements.md`,
  `docs/plans/2026-05-25-006-feat-thread-progress-md-plan.md`, and
  `packages/api/src/lib/spaces/customer-onboarding-progress-md.ts`.
- The current thread progress file path is
  `tenants/<tenant-slug>/threads/<thread-id>/PROGRESS.md`; future Goal folders
  should evolve this prefix rather than introduce an unrelated file surface.
- The Interpretable Context Methodology / Model Workspace Protocol paper
  motivates the folder-native architecture: sequential workflows can be
  orchestrated through numbered folders and markdown context instead of heavy
  framework code. See <https://arxiv.org/abs/2603.16021>.
- Every's Codex knowledge-work framing motivates the user-facing concepts of
  Delegate vs Collaborate, explicit Goals, and a maturity ladder. See
  <https://every.to/guides/codex-for-knowledge-work>.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R8-R12][Technical] Define the exact S3 key conventions for
  Space-owned Goal templates and thread-owned Goal folders while preserving the
  existing `PROGRESS.md` path compatibility.
- [Affects R13-R15][Technical] Define which structured state changes trigger
  markdown refreshes and how refresh failures are surfaced without blocking
  canonical writes.
- [Affects R14, R16][Technical] Define how Company Brain ingests completed Goal
  folders and distinguishes durable decisions from transient notes.
- [Affects R5, R9][Design] Define the right panel language and hierarchy:
  whether the current Progress panel becomes a Goal panel, and how much of
  `GOAL.md`, `PROGRESS.md`, and artifacts should be visible to users.
- [Affects R11, R18][Docs] Define the first docs-visible portability statement
  without implying export UI is already available.

---

## Next Steps

-> /ce-plan for structured implementation planning
