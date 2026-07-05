---
date: 2026-07-05
topic: think-170-space-workflows-worktasks
linear_issue: THINK-170
origin: docs/solutions/logic-errors/customer-onboarding-chat-interceptor-swallows-thread-2026-07-05.md
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
---

# Space Workflows as Data: Worktask Templates + Work Items + Agent Tools

## Problem Frame

The Customer Onboarding space is implemented as ~7.5k lines of bespoke
TypeScript under `packages/api/src/lib/spaces/customer-onboarding-*.ts`: a
regex-NLU chat interceptor, canned summary builders, a hardcoded checklist
seed, and GOAL/PROGRESS markdown refreshers. THINK-170's bug is the existence
proof that this shape is wrong:

1. **Interception is the wrong ownership model.** A deterministic pseudo-agent
   in the `sendMessage` resolver (`applyCustomerOnboardingChatUpdate`,
   called at `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts:414`)
   grabs the turn for nearly every un-@mentioned message in a workflow-tagged
   thread and suppresses Pi agent dispatch
   (`sendMessage.agent-handling.ts:100-106`). The thread reads as a broken bot.
2. **Bespoke workflow code rots independently of the platform.** The
   interceptor's status summary counts `linked_tasks WHERE provider='thinkwork'`
   while the real rows are `provider='lastmile'` and live state moved to
   `work_items` — so it answers "Progress: 0/0" forever.
3. **The workflow definition is code, not data.** The 7-item checklist lives in
   `customer-onboarding-seed.ts` (`CUSTOMER_ONBOARDING_CHECKLIST_ITEMS`);
   changing a task, role, or intake field means a TypeScript deploy.

The product question (Eric, THINK-170): what is the right way to configure a
workflow — a set of tasks that need to be completed — for a space? Answer
scoped here: **space workflows become data-defined worktask templates that
instantiate Work Items, the platform agent owns every thread turn, and the
agent operates on workflow state through Work Item tools.**

## Decisions Settled in Brainstorming

- **D1 — Surgical interceptor retirement ships first, independent of the
  redesign.** THINK-170 is a live High-priority breakage; the fix is small and
  reversible (stop consuming the turn; let dispatch fall through to Thread
  Mode). The findings doc explicitly recommends against patching the regex.
  The redesign then deletes the rest of the layer at its own pace.
  Accepted trade-off: prefixed commands like "Collect tax exemption forms:
  done" stop being deterministic API-layer updates and become agent-mediated —
  the agent already has `set_work_item_status` / `set_task_status`
  (`packages/pi-extensions/src/task-status.ts`) to honor them.
- **D2 — No new "worktask" entity.** `work_items` is already the canonical
  unit of durable work (CONCEPTS.md:72), and a template primitive already
  exists: `space_checklist_templates` / `space_checklist_items`
  (`packages/database-pg/src/schema/spaces.ts:147,180`), which
  `work_items.template_source_id` already references. "Worktask template" is
  product vocabulary for a generalized, data-defined version of that template
  layer — not a new table family. Exact schema evolution is planning's call.
- **D3 — Provider neutrality is a hard requirement** (see R4). LastMile being
  this tenant's onboarding system of record must be expressed as template
  data + external-ref plumbing, never as workflow logic.

## Goals

- Any user message in a workflow-tagged space thread gets a real platform-agent
  turn, governed by the same Thread Mode rules as every other space thread.
- A space workflow ("set of tasks to complete, with roles, required intake,
  and completion gates") is defined as data an operator can change without a
  code deploy, and Customer Onboarding is re-expressed as the first instance.
- Workflow state has one source of truth — `work_items` — and the agent reads
  and updates it through tools.
- The bespoke `customer-onboarding-*.ts` layer is deleted.

## Non-Goals

- No generic visual workflow-builder UI in this scope; data-defined templates
  with existing admin/operator surfaces are enough for v1.
- No state-machine/orchestration engine. Workflows here are checklists with
  applicability and completion semantics, not DAG execution (Automations own
  triggered execution; the External Agent Resource Broker, THINK-117, owns the
  cross-system command-center surface).
- No rewrite of the Twenty CRM webhook intake or the LastMile plugin adapter;
  they remain deterministic data plumbing.
- No multi-agent routing changes; the one-platform-agent-per-tenant model is a
  settled premise.

## Requirements

### R0 — Immediate relief: retire the interception path (surgical, first PR)

- `sendMessage` never suppresses agent dispatch for user messages in Customer
  Onboarding threads: the `customerOnboardingHandled` short-circuit and the
  `applyCustomerOnboardingChatUpdate` call are removed; dispatch falls through
  to `shouldDispatchDefaultAgentTurn`'s normal Thread Mode logic.
- No canned `sender_type: "system"` workflow replies are inserted by the API
  layer in response to chat messages.
- Acceptance: posting "can you generate a report of the current status of this
  company onboard?" in thread d1d1049d (dev) produces a real agent turn, not a
  57 ms system insert.

### R1 — Space workflows are data

- A space workflow is a **worktask template set**: an ordered list of task
  definitions (key, title, description, role, required flag, applicability
  rule, optional external-task binding) plus required intake fields and
  completion criteria for the workflow as a whole.
- Templates live in the database (evolving the existing
  `space_checklist_templates`/`space_checklist_items` layer), are per-tenant /
  per-space, and are editable through operator surfaces without a deploy.
- Starting a workflow (CRM webhook, manual start, thread creation) materializes
  the template into `work_items` — the same materialization path regardless of
  which trigger fired.
- The current hardcoded `CUSTOMER_ONBOARDING_CHECKLIST_ITEMS` becomes seed
  data for the Customer Onboarding template — a default row set, not a code
  constant consulted at runtime.

### R2 — Work Items are the only workflow state source

- All workflow status — counts, per-task state, missing intake — is derived
  from `work_items` (and their metadata/events), never from `linked_tasks`
  provider-filtered queries or thread-metadata snapshots.
- `linked_tasks` remains only as the transitional compatibility bridge already
  described in CONCEPTS.md ("Linked Task Compatibility"), with its removal
  criteria unchanged.
- Intake facts (e.g. billing address, sales rep) get a defined home readable
  by the agent and writable by both webhook seeding and agent tools; the regex
  fact-extractor is deleted, not relocated.

### R3 — The agent owns the turn and operates workflow state through tools

- The platform agent answers every human message in a workflow thread. Status
  reports, task updates phrased in natural language, assignment requests, and
  intake capture are all agent behavior backed by tools — no keyword routing
  anywhere in the API layer.
- Tool surface (product-level; exact shapes are planning's): the agent can
  **list/read** the work items and required intake for its thread/space,
  **update status** (exists today: `set_work_item_status`), **assign** an
  owner, and **record intake facts**. Read/list is the gap — today only
  status-write tools exist.
- Workflow guidance (what the tasks are for, role expectations, completion
  gates) reaches the agent as context derived from the template — replacing
  the bespoke seeded coordinator prompt and GOAL/PROGRESS markdown refreshers.
  The generated `customer-onboarding-goal-md.ts` / `-progress-md.ts` builders
  are retired; if a progress artifact is still wanted, the agent produces it
  from work-item state.

### R4 — Provider neutrality

- Workflow logic (templates, materialization, status derivation, agent tools)
  never branches on an external provider. External systems of record
  (LastMile, Linear, Twenty, …) attach to a work item only via
  `work_item_external_refs` and plugin adapters.
- A template task that must exist in an external system expresses that as a
  declarative external-task binding on the template row (the existing
  `external_task_template` seam), resolved by the plugin adapter at
  materialization/sync time.
- Acceptance test for the design: switching a tenant's onboarding system of
  record from LastMile to another provider touches template data and adapter
  config only — zero workflow-code changes.

### R5 — Delete the bespoke layer

- End state: the `customer-onboarding-*.ts` modules under
  `packages/api/src/lib/spaces/` (chat-updates, seed, workflow, source-files,
  goal-md, progress-md — ~7.5k lines incl. tests) are deleted or reduced to
  thin template-seed + adapter glue. Deletion is the success metric of the
  redesign, phased behind proven replacements per the
  don't-cutover-before-replacement-proven rule.

## Success Criteria

1. Zero canned system replies in onboarding threads; every user message yields
   an agent turn (or intentional Thread Mode silence), verified on dev.
2. "What's the onboarding status?" answered by the agent from `work_items`
   with correct counts on the mcphersonoil.com thread (not 0/0).
3. "Collect tax exemption forms: done" (natural language) results in the
   corresponding work item moving to done via an agent tool call.
4. Customer Onboarding's task list is changeable via template data with no
   deploy, and a second space workflow can be defined from data alone.
5. Bespoke-module line count trends to ~0; no `provider='thinkwork'` style
   filters remain in workflow logic.

## Sequencing Sketch (for planning)

1. **Phase 0 (surgical, immediate):** R0 — remove interception, restore agent
   dispatch. Ship alone.
2. **Phase 1:** R3 tool gap — work-item read/list + intake tools; template-derived
   agent context. Prove status/report/update flows live on dev.
3. **Phase 2:** R1/R2 — template-as-data materialization path unification;
   single state source; retire linked_tasks reads from workflow logic.
4. **Phase 3:** R5 — delete the bespoke modules; migrate the existing
   mcphersonoil tenant thread(s).

## Open Questions / Risks (for Requirements Review)

- **Q1 — Intake facts home:** thread metadata (`customerOnboarding.facts`) vs
  work-item metadata vs a dedicated intake structure on the workflow instance.
  Recommendation: decide in planning; requirement is only "one agent-readable,
  tool-writable home."
- **Q2 — How much operator UI ships in v1?** Recommendation: none beyond
  existing admin surfaces — template rows seeded + editable via data; a
  template editor is a follow-up issue if operators actually need it.
- **Q3 — Deterministic escalation:** the old layer emitted `human_question`
  skill prompts and role-based assignment nudges. Recommendation: fold into
  agent behavior via template context (the agent asks); keep no deterministic
  chat-side-effects. Flag if Eric wants any guaranteed-deterministic nudges.
- **Risk:** agent-mediated task updates are less deterministic than the old
  prefixed-command path; mitigated by tool availability + template context,
  and measurable via success criterion 3.
