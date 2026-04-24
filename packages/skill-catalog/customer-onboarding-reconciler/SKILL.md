---
name: customer-onboarding-reconciler
description: >
  Reconciler-shaped skill that drives a new customer from opportunity-won
  to fully onboarded. Every invocation reads current state, creates only
  the tasks that are still missing, and exits. Webhook anchor for D7a /
  D7b in the composable-skills plan.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
---

# Customer Onboarding Reconciler

Agent-driven reconciler tick. The model invokes each sub-skill via the
`Skill(slug, inputs)` meta-tool in the three-phase order below. Fail
fast on missing critical gather — duplicates in the task system are
the worst-case outcome of an unsafe tick.

## Why this is a reconciler, not a workflow

Onboarding waits on humans: clarification answers, contract signatures,
payment setup, team assignments. A workflow-shape composition would try
to encode those waits inline — which is exactly what the plan's D7a
decision rejected. Instead, this skill treats onboarding as a
desired-state problem: given the customer's current state and the
opportunity context, produce the set of tasks that should exist. Create
what's missing, leave what's already present. Exit. When a task
finishes, a task-event webhook re-invokes and we reconcile again.

Over many ticks the skill converges. No single invocation holds an
AgentCore session open; no scheduler owns "wait for X days." The task
system owns the HITL state.

## Naming (U8 migration note)

The plan's canonical name for this skill is `customer-onboarding`. A
legacy `execution: context` skill with that slug already exists
(`packages/skill-catalog/customer-onboarding/`), so U8 followed the
recommended default in
`docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`:
pick a different canonical slug rather than coordinate a data
migration. The reconciler lives at `customer-onboarding-reconciler` and
the legacy `customer-onboarding` continues working unchanged for any
tenants that still reference it.

## Inputs

| Field           | Required | Type   | Notes |
|-----------------|----------|--------|-------|
| `customerId`    | Yes      | string | Stable CRM customer id. |
| `opportunityId` | Yes      | string | Stable CRM opportunity id. |

## How a tick runs

Call each step via `Skill(slug, inputs)`. Do NOT `asyncio.sleep` or
otherwise wait for humans within a tick — waiting defeats the
reconciler model. CI's `no-blocking-sleep` lint enforces this on any
sub-skill the agent might author.

1. **Gather current state (parallel-safe).** Call these three sub-skills
   and collect successful returns into `gathered`:
   - `crm_account_summary({customer: customerId})` — **critical**.
   - `lastmile_tasks_list({subject_kind: "customer", subject_id: customerId, trigger: "customer-onboarding-reconciler"})` — **critical**.
   - `crm_opportunity_summary({opportunity: opportunityId})` — optional
     (footer note on missing contract context).

   If **either** critical gather errors or returns empty, ABORT the
   tick. Do not proceed to act. A tick that acts on partial state will
   duplicate tasks the next time the real `existing_tasks` comes back.

2. **Synthesize the gap.** Call `Skill("synthesize", {framed, gathered, focus: "gap_analysis"})`
   with `framed = "Onboarding reconciliation for customer {customerId}."`
   Store the result as `gap_analysis`. The focus is hard-coded — this
   skill is specifically a gap analysis, not a general summary.

3. **Act on the gap.** Call
   `Skill("customer-onboarding-reconciler/act", {customerId, opportunityId, gap_analysis, existing_tasks: gathered.existing_tasks})`.
   The `act` sub-skill decides what to mutate this tick. Given the gap
   analysis + existing tasks, it calls `lastmile_tasks_create` only for
   missing tasks.

Implicit before/after:

- Before step 1: `recall` (managed memory) or `hindsight_recall` (when
  Hindsight is enabled) surfaces prior learnings scoped to
  `(tenant, customer, skill)`. On the first tick the pool is empty; on
  later ticks the runner may surface "ABC Fuels wants PO setup moved
  ahead of contract signing."
- After step 3: `reflect` or `hindsight_reflect` captures up to 3
  learnings — patterns like "tasks created in this order tend to
  finish this fast."

## Termination

Subsequent ticks observe that `existing_tasks ⊇ tasks the gap analysis
would create` and the `act` sub-skill emits an empty action summary.
Delivery-layer logic treats an empty action summary as a no-op: the run
still records as `complete`, but nothing is announced to the agent
owner. The reconciler-HITL integration test asserts this explicitly —
tick N with all tasks complete produces zero new tasks and zero
duplicate creates.

## Invocation paths

| Path    | Entry point                                 | Typical invocation |
|---------|---------------------------------------------|---------------------|
| webhook | `POST /webhooks/crm-opportunity/{tenantId}` | CRM `opportunity.won` event |
| webhook | `POST /webhooks/task-event/{tenantId}`      | A task spawned by a prior tick flips to `done` |
| catalog | admin `startSkillRun` mutation              | Operator forces a tick from the admin Skills detail page |

No `scheduled` trigger in v1 — reconciliation is event-driven. A cron
fallback is a plausible Phase-2 addition once we see how long quiet
periods actually run.

## Delivery

Runs route notifications to the owning agent's configured channel (DM,
email, or admin fallback). There is no chat thread because
webhook-triggered runs don't have an invoker thread. The run still
shows up in the admin UI under the owning agent.

If the owning agent is null the run emits a `notification_pending`
metric and routes to a tenant-admin fallback channel if one is
configured; otherwise the run completes with `notification_pending=true`
and the admin sees it in the filter.

## Connector dependencies

- `crm_account_summary` — customer-level CRM adapter.
- `crm_opportunity_summary` — opportunity-level CRM adapter (separate
  endpoint in most CRMs).
- `lastmile_tasks_list` / `lastmile_tasks_create` — the task-system
  connectors used by the `act` sub-skill.

At launch, connector failures in `crm_account_summary` or
`lastmile_tasks_list` abort the tick. Once the connector surface
stabilizes (post-launch), this skill can relax the contract gather to
footer-only — contract context is nice-to-have but not load-bearing.

## Migration note

v2.0.0 landed the current `execution: context` shape (plan §U8): the
model invokes each sub-skill directly via the Skill meta-tool so the
same reconciler semantics run on the unified dispatch path.
