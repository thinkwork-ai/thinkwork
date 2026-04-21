---
name: customer-onboarding-reconciler
description: >
  Reconciler-shaped composition that drives a new customer from opportunity-
  won to fully onboarded. Every invocation reads current state, creates only
  the tasks that are still missing, and exits. Webhook anchor for D7a / D7b
  in the composable-skills plan.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Customer Onboarding Reconciler

## Why this is a reconciler, not a workflow

Onboarding waits on humans: clarification answers, contract signatures,
payment setup, team assignments. A workflow-shape composition would try
to encode those waits inline — which is exactly what the plan's D7a
decision rejected. Instead, this composition treats onboarding as a
desired-state problem: given the customer's current state and the
opportunity context, produce the set of tasks that should exist. Create
what's missing, leave what's already present. Exit. When a task finishes,
a task-event webhook re-invokes the composition and we reconcile again.

Over many ticks the composition converges. No single invocation holds an
AgentCore session open; no scheduler owns "wait for X days." The task
system owns the HITL state.

## Naming (Unit 8 migration note)

The plan's canonical name for this composition is `customer-onboarding`.
A legacy `execution: context` skill with that slug already exists
(`packages/skill-catalog/customer-onboarding/`), so Unit 8 followed the
recommended default in
`docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`:
pick a different canonical slug rather than coordinate a data migration.
The reconciler lives at `customer-onboarding-reconciler` and the legacy
`customer-onboarding` continues working unchanged for any tenants that
still reference it.

## How a tick runs

1. **gather** (parallel, 3 branches — `customer`, `existing_tasks`,
   `contract`)
   - `customer` + `existing_tasks` are **critical**. Without either, this
     tick can't safely act — `existing_tasks` in particular is what keeps
     the composition from re-creating a task that already exists. If
     either gather fails, the whole run aborts rather than creating
     duplicates.
   - `on_branch_failure: fail` — differs from the deliverable shape's
     `continue_with_footer`. A footered gap-analysis would invite
     action-step errors.
2. **synthesize** — reads the three branches + produces a structured gap
   analysis: what should exist vs. what does, with reasons and owners.
3. **act** (agent-mode sub-skill, `customer-onboarding-reconciler/act`)
   — decides what to mutate this tick. Given the gap analysis + existing
   tasks, calls `lastmile_tasks_create` only for missing tasks. The
   agent-mode sub-skill MUST NOT `asyncio.sleep` or otherwise wait for a
   human — waiting defeats the reconciler model. CI's
   `no-blocking-sleep` lint enforces this.

Implicit before/after:
- Before step 1: `compound.recall` injects prior learnings scoped to
  (tenant, customer, skill). On the first tick the pool is empty; on
  later ticks the runner may surface "ABC Fuels wants PO setup moved
  ahead of contract signing."
- After step 3: `compound.reflect` captures up to 3 learnings from the
  run — patterns like "tasks created in this order tend to finish this
  fast."

## Termination

Subsequent ticks observe that `existing_tasks ⊇ tasks the gap analysis
would create` and the `act` sub-skill emits an empty action summary.
Delivery-layer logic treats an empty action summary as a no-op: the run
still records as `complete`, but nothing is announced to the agent
owner. The reconciler-HITL integration test asserts this explicitly —
tick N with all tasks complete produces zero new tasks and zero
duplicate creates.

## Invocation paths

| Path      | Entry point                              | Typical invocation                                            |
|-----------|------------------------------------------|---------------------------------------------------------------|
| webhook   | `POST /webhooks/crm-opportunity/{tenantId}` | CRM "opportunity.won" event                                 |
| webhook   | `POST /webhooks/task-event/{tenantId}`   | A task spawned by a prior tick flips to done                  |
| catalog   | admin `startSkillRun` mutation           | Operator forces a tick from Unit 7's skills detail page       |

No `scheduled` trigger in v1 — reconciliation is event-driven. A cron
fallback is a plausible Phase-2 addition once we see how long quiet
periods actually run.

## Delivery

`delivery: agent_owner` — runs route notifications to the owning agent's
configured channel (DM, email, or admin fallback). There is no chat
thread because webhook-triggered runs don't have an invoker thread. The
run still shows up in the admin UI under the owning agent.

If `agent_owner` is null the run emits a `notification_pending` metric
and routes to a tenant-admin fallback channel if one is configured;
otherwise the run completes with `notification_pending=true` and the
admin sees it in Unit 7's filter.

## Connector dependencies

- `crm_account_summary` — customer-level CRM adapter.
- `crm_opportunity_summary` — opportunity-level CRM adapter (separate
  endpoint in most CRMs).
- `lastmile_tasks_list` / `lastmile_tasks_create` — the task-system
  connectors used by the act sub-skill.

At launch, connector failures in `customer` or `existing_tasks` abort
the tick. Once the connector surface stabilizes (post-launch), the
reconciler can relax to `continue_with_footer` for `contract` only —
contract context is nice-to-have but not load-bearing.
