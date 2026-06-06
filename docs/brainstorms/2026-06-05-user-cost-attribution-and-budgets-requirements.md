---
date: 2026-06-05
topic: user-cost-attribution-and-budgets
---

# User Cost Attribution and Budgets

## Problem Frame

ThinkWork now operates around one tenant platform agent, so analytics that break spend down by agent no longer help operators understand who is driving cost. The current Settings -> Analytics view can truthfully show a single "ThinkWork" row under "Cost by Agent," but that row collapses every human, scheduled job, and user-owned workflow into one bucket.

Operators need the cost surface to answer "which user is responsible for this spend?" and need budget controls that limit a user's owned work, not a legacy agent row. User-owned scheduled work should not evade budget enforcement simply because it runs without the user actively present.

---

## Actors

- A1. Tenant admin: reviews analytics, configures user budgets, and handles budget exceptions.
- A2. Tenant user: starts interactive work and configures scheduled or background work.
- A3. Scheduled/background runtime: runs work that was configured by a tenant user.
- A4. Reporting surface: presents tenant, user, model, and trend cost views in Settings -> Analytics.

---

## Key Flows

- F1. Admin reviews user spend
  - **Trigger:** A tenant admin opens Settings -> Analytics.
  - **Actors:** A1, A4
  - **Steps:** The page shows the existing cost summary, trend, and model tables. The legacy "Cost by Agent" card is replaced with "Cost by User." Rows are sorted by spend and show each user, their events, and their cost for the reporting period.
  - **Outcome:** The admin can identify which users are driving spend without mentally mapping everything through the single platform agent.
  - **Covered by:** R1, R2, R3

- F2. User-owned automation incurs cost
  - **Trigger:** A scheduled job or background workflow runs after being configured by a tenant user.
  - **Actors:** A2, A3, A4
  - **Steps:** The runtime attributes the resulting cost to the configuring or owning user. That spend appears in the user's analytics row and counts against that user's budget.
  - **Outcome:** Background work has a human budget owner and cannot bypass per-user controls.
  - **Covered by:** R4, R5, R8

- F3. User exceeds budget
  - **Trigger:** A user's monthly budget is exhausted.
  - **Actors:** A1, A2, A3
  - **Steps:** The platform blocks new interactive work owned by that user and pauses scheduled/background work configured by that user. Admins can still see the budget state in reporting and decide whether to raise or reset the budget.
  - **Outcome:** Spend enforcement is user-scoped and includes both foreground and background work.
  - **Covered by:** R6, R7, R9

---

## Requirements

**Reporting**

- R1. Settings -> Analytics replaces the "Cost by Agent" card with "Cost by User."
- R2. The "Cost by User" table shows user identity, event count, and cost for the reporting period, sorted by cost descending.
- R3. Existing tenant-wide summary, trend, and model cost views remain available so user attribution complements rather than replaces aggregate reporting.
- R4. Cost reports attribute interactive work to the user who initiated the work.
- R5. Cost reports attribute scheduled or background work to the user who configured or owns that work.

**Budgets**

- R6. Budgets are configurable per user rather than per agent.
- R7. User budget status is visible in analytics so admins can see limit, spend, remaining budget, percent used, and over-budget state.
- R8. User-owned scheduled and background work counts against the owning user's budget.
- R9. When a user exceeds budget, the platform pauses all work owned by that user, including scheduled/background jobs they configured.

**Compatibility**

- R10. Tenant-level budget reporting remains supported for overall spend control.
- R11. Legacy agent-scoped budget and cost wording should be retired from user-facing Settings -> Analytics surfaces in the one-platform-agent product shape.
- R12. Costs with no resolvable user owner are not silently folded into a user's budget; they should appear as unattributed/system spend for admin visibility until planning defines the exact handling.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a tenant with three users who generated cost in the last 30 days, when an admin opens Settings -> Analytics, then the breakdown card is titled "Cost by User" and shows one row per spending user, not one row for the platform agent.
- AE2. **Covers R5, R8.** Given Lin configured a daily scheduled job, when that job runs overnight and incurs cost, then the cost appears in Lin's row and counts against Lin's budget.
- AE3. **Covers R6, R9.** Given Eric's user budget is exceeded, when Eric tries to start a new thread turn or one of Eric's scheduled jobs fires, then the platform blocks or pauses that work because it is owned by Eric.
- AE4. **Covers R10, R11.** Given a tenant admin wants an overall spend view, when they open analytics, then tenant totals still appear, but the per-actor breakdown no longer asks them to interpret a single "ThinkWork" agent row.

---

## Success Criteria

- Admins can answer which users are driving spend from Settings -> Analytics without relying on legacy agent terminology.
- User budget enforcement covers both interactive work and user-owned background work.
- Planning can proceed without inventing the chargeback identity or budget-exceed behavior.

---

## Scope Boundaries

- This does not reintroduce multiple agents or per-agent product controls.
- This does not change model-level cost reporting except where model spend participates in user totals.
- This does not define a full billing product, invoicing workflow, or payment enforcement.
- This does not require users to self-manage budgets unless a later product decision adds that surface.

---

## Key Decisions

- Cost attribution axis: use users, not agents, because the one-platform-agent model makes per-agent breakdowns low-signal.
- Automation ownership: scheduled/background work is charged to the user who configured or owns it.
- Budget enforcement: exceeding a user budget pauses all work owned by that user, including configured scheduled jobs.

---

## Dependencies / Assumptions

- The implementation must validate where user ownership already exists for interactive turns, scheduled jobs, and background work.
- The current cost event and budget policy model is agent-oriented; planning should determine the smallest compatible data/API change to support user attribution and user budgets.
- Some system-originated work may not have a clear user owner. The product requirement is to keep that spend visible rather than hiding it in a user row.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R12][Technical] Which cost-producing paths currently lack a reliable user owner, and should any be backfilled from thread owner, scheduled job owner, or system actor metadata?
- [Affects R9][Technical] What is the exact pause mechanism for user-owned scheduled jobs and background work, and how should admins unpause after a budget increase or reset?
- [Affects R11][Technical] Which legacy `costByAgent` and agent budget API surfaces should be kept as compatibility aliases versus renamed or replaced?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
