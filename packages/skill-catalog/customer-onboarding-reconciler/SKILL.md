---
name: customer-onboarding-reconciler
description: >
  Reconciler-shaped skill that drives a new customer from opportunity-won
  to fully onboarded. Every invocation reads current state, creates only
  the tasks that are still missing, and exits.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
allowed-tools:
  - Skill
  - recall
  - reflect
---

# Customer Onboarding Reconciler

You are a **reconciler**: on every invocation, compare the desired set of onboarding tasks to what already exists, create the missing ones, and exit. You do NOT wait on humans. Waits happen *between* your invocations — when a task finishes, a webhook re-invokes you and you reconcile again.

## Why this is a reconciler, not a workflow

Onboarding waits on humans: clarification answers, contract signatures, payment setup, team assignments. A workflow shape would try to encode those waits inline — which is exactly wrong for a stateless, pooled agent runtime. This skill treats onboarding as a desired-state problem:

> *Given the customer's current state and the opportunity context, produce the set of tasks that should exist. Create what's missing, leave what's already present. Exit.*

Over many ticks the skill converges. No single invocation holds a session open; no scheduler owns "wait for X days." The task system owns the HITL state.

**Never `asyncio.sleep` or otherwise wait for humans within a tick.** If you find yourself wanting to, the answer is to exit — the next tick will handle whatever triggered the wait.

## Inputs

| Field           | Required | Type   | Notes |
|-----------------|----------|--------|-------|
| `customerId`    | Yes      | string | Stable CRM customer id. |
| `opportunityId` | Yes      | string | Stable CRM opportunity id. |

## Method

### 1. Pull prior learnings

```
recall({skill_id: "customer-onboarding-reconciler", subject_entity_id: customerId})
```

Onboarding learnings tend to be order-preferences ("This tenant wants PO setup before contract signing"). Let them shape step 3's gap analysis.

### 2. Gather current state in parallel

Fire these concurrently:

**Critical (abort tick if either fails):**
- `Skill("crm_account_summary", {customer: customerId})` — customer record: industry, size, contract stage, key contacts.
- `Skill("lastmile_tasks_list", {subject_kind: "customer", subject_id: customerId, trigger: "customer-onboarding-reconciler"})` — **all existing tasks this reconciler has created before, regardless of status.**

**Nice-to-have:**
- `Skill("crm_opportunity_summary", {opportunity: opportunityId})` — deal shape, contract amount, close date. Footer note if missing.

If **either** critical gather errors or returns empty, **ABORT the tick**. Do not proceed to step 3. A tick that acts on partial state will duplicate tasks the next time the real `existing_tasks` comes back.

### 3. Compute the gap (inline)

Given the customer's current state + the opportunity context, determine what tasks should exist. A standard onboarding includes:

- **Intake call** — 30-min kickoff with the customer's project lead.
- **Contract signature** — countersigned MSA + SOW.
- **Billing setup** — PO, payment method, invoice recipient.
- **Technical provisioning** — subdomain, SSO config, seat provisioning.
- **Team assignments** — CSM + AE + support handoff.
- **Documentation handoff** — onboarding kit, admin guide.

Adjust based on prior-learnings (step 1) and opportunity context (step 2's optional gather). Example adjustments:
- Contract already signed in the opportunity record → skip "contract signature."
- SMB tier (`crm_account_summary.tier === "SMB"`) → collapse "team assignments" into "CSM only."
- Prior learnings say "customer prefers PO before contract" → reorder those two.

**Gap = (desired tasks) − (existing tasks matching subject+trigger).**

Produce your gap analysis as a structured list: each entry has `{title, description, assignee_hint, depends_on?}`.

Keep the gap list internal — don't render it as output. It feeds step 4 only.

### 4. Create the missing tasks

For each entry in the gap, call:

```
Skill("lastmile_tasks_create", {
  subject_kind: "customer",
  subject_id: customerId,
  trigger: "customer-onboarding-reconciler",
  title: "...",
  description: "...",
  assignee_hint: "...",
  depends_on: [...]  // optional; task ids from existing_tasks that must complete first
})
```

**Do not create a task if an existing task matches `{subject, trigger, title}` — even if the existing one is `done`.** Matching is case-insensitive on title after trimming. This is the idempotency invariant: multiple ticks with the same gap produce zero duplicate creates.

### 5. Reflect (if anything worth saving)

```
reflect({
  skill_id: "customer-onboarding-reconciler",
  subject_entity_id: customerId,
  text: "..."
})
```

Up to 3 observations. Good patterns: ordering preferences, timing patterns, tier-specific adjustments. Skip if the tick was routine.

## Termination invariant

Subsequent ticks observe that `existing_tasks ⊇ desired_tasks` and the gap is empty. Creating zero tasks is a valid, expected outcome — it means the customer's onboarding is in a steady state.

An empty-gap tick still records as `status=complete` in `skill_runs`, but the delivery layer treats an empty-action tick as a no-op: nothing is announced to the agent owner. Only ticks that actually create tasks produce notifications.

## Invocation paths

| Path    | Entry point                                 | Typical invocation |
|---------|---------------------------------------------|---------------------|
| webhook | `POST /webhooks/crm-opportunity/{tenantId}` | CRM `opportunity.won` event starts onboarding |
| webhook | `POST /webhooks/task-event/{tenantId}`      | A task finishes → reconcile again |
| catalog | admin `startSkillRun` mutation              | Operator forces a tick from the admin |

No `scheduled` trigger in v1 — reconciliation is event-driven. A cron fallback is a plausible Phase-2 addition once we see how long quiet periods actually run.

## Delivery

Webhook-triggered runs don't have an invoker thread, so notifications route to the owning agent's configured channel (DM, email, admin fallback). If the owning agent is null the run emits a `notification_pending` metric and routes to a tenant-admin fallback; otherwise completes with `notification_pending=true` and the admin sees it in the filter.

## Connector dependencies

- `crm_account_summary` — customer-level CRM adapter.
- `crm_opportunity_summary` — opportunity-level CRM adapter.
- `lastmile_tasks_list` / `lastmile_tasks_create` — task-system connectors.

At launch, failures in `crm_account_summary` or `lastmile_tasks_list` abort the tick. Once the connector surface stabilizes, this skill can relax `crm_opportunity_summary` to footer-only (already nice-to-have) and consider relaxing others post-launch.

## Naming note

The plan's canonical name for this skill is `customer-onboarding`, but a legacy `execution: context` skill with that slug already exists (`packages/skill-catalog/customer-onboarding/`). This skill lives at `customer-onboarding-reconciler`. The legacy slug continues working for any tenants that still reference it.

## What this skill does NOT do

- Doesn't wait for humans within a tick.
- Doesn't call retired helper skills (`frame`, `synthesize`, `gather`, `compound`).
- Doesn't modify CRM records.
- Doesn't delete or reassign tasks — creation-only.
- Doesn't re-create tasks that already exist in any status (done tasks still count as existing).
