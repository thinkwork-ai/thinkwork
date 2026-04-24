---
name: account-health-review
description: >
  Periodic risk-focused review of a customer's health signals. Aggregates
  CRM, product usage, AR posture, support load, and engagement over a
  configurable window; produces a health_report deliverable.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.1.0"
allowed-tools:
  - render_package
  - hindsight_recall
  - hindsight_reflect
  - crm_account_summary
  - product_usage_summary
  - ar_summary
  - support_incidents_summary
  - engagement_summary
---

# Account Health Review

You are producing a risk-focused health report on `customer` over `period`. The audience is an internal CSM or AE reviewing the account ahead of a QBR, renewal, or standing check-in. The deliverable has a fixed shape; this document is the contract + method.

## Inputs

| Field        | Required | Type   | Notes |
|--------------|----------|--------|-------|
| `customer`   | Yes      | string | Customer identifier. |
| `period`     | No       | enum   | `last_30_days` \| `last_quarter` \| `last_year`. Default `last_30_days`. |
| `agent_name` | No       | string | Passed to the render_package metadata for attribution. |

## Deliverable shape

Same four-section shape as `sales-prep`, but **always risk-oriented**:

- **Risks** — degradation signals from CRM + AR + support + engagement.
- **Opportunities** — expansion or stabilization levers that surfaced.
- **Open questions** — what the CSM should clarify before the next touchpoint.
- **Talking points** — ordered most-to-least important for the next conversation.

Cite every finding. Never invent facts. Use `render_package(synthesis=..., format="health_report", metadata=...)` for the final render.

## Method

### 1. Pull prior learnings

```
hindsight_recall(skill_id="account-health-review", subject_entity_id=customer)
```

Health-review learnings tend to be *patterns* (e.g. "Always check AR before talking about renewal"). Weight them into step 4's synthesis.

### 2. Scratch-restate the goal

Internal scratchpad (≤150 words, not part of output):

- **Goal:** Specific health picture for `customer` over `period`.
- **Constraints:** Internal audience, no customer-facing tone.
- **Known unknowns:** What you need to gather to answer.
- **Decision criteria:** Would a CSM know what to say next?

### 3. Gather in parallel

Fire these concurrently:

**Critical (abort if it fails):**
- `crm_account_summary(customer=customer, period=period)` — account shape, AE, renewal date, last activity. Without this the review has no anchor.

**Nice-to-have (degrade gracefully — footer note per missing source):**
- `product_usage_summary(customer=customer, period=period)` — MAU, feature adoption, trend.
- `ar_summary(customer=customer)` — invoice status, DSO, past-due.
- `support_incidents_summary(customer=customer, period=period)` — ticket volume, NPS, severity mix.
- `engagement_summary(customer=customer, period=period)` — meeting cadence, email responsiveness, champion activity.

If a nice-to-have tool is missing or errors: continue. Footer line: `> Note: support data unavailable.` (etc.)

### 4. Synthesize

Focus is **always `risks`** for this skill — even when the customer looks healthy, the CSM wants to see what *could* go wrong. Produce the four sections as a single Markdown string with `##` headings in this exact order and spelling — `render_package` embeds your synthesis verbatim:

```
## Risks
- ...

## Opportunities
- ...

## Open questions
- ...

## Talking points
- ...
```

Rules:

- **Risks:** Lead. Quantify where possible (e.g. "Open tickets up 3× vs. last period"). Every risk cites its source.
- **Opportunities:** Short. Expansion or re-engagement levers only; don't pad.
- **Open questions:** Things the CSM needs to clarify with the customer or AE.
- **Talking points:** Ranked top-5 topics for the next touchpoint.

Cite every finding. 400 words max across the four sections.

### 5. Render

```
render_package(
  synthesis=<your four-section Markdown string>,
  format="health_report",
  metadata={"customer": customer, "period": period, "agent_name": agent_name}
)
```

Return the rendered Markdown verbatim.

### 6. Reflect

If the run surfaced a pattern worth keeping — a new risk indicator, a correction to a prior assumption, a source that paid off — call:

```
hindsight_reflect(
  skill_id="account-health-review",
  subject_entity_id=customer,
  text="..."
)
```

Up to 3 observations per run. Skip if nothing new.

## Degrading gracefully

- **CRM critical:** If `crm_account_summary` errors or returns empty, stop. Tell the user the CRM connector is unavailable — don't fabricate account context.
- **Every other gather:** Catch, record in footer, continue.
- **Synthesis failure:** If step 4 can't produce a coherent brief from the partial gather, skip step 5 and return the scratchpad + gathered data so the CSM can triage manually.

## Scheduling

Default: weekly, Monday 09:00. Tenants typically override to match their standing-meeting rhythm (e.g. Thursday morning for QBR-heavy teams). The `from_tenant_config: default_customer` binding lets the weekly review target a rotating focus account without re-authoring the schedule.

## Invocation paths

| Path      | Entry point              | Typical invocation |
|-----------|--------------------------|---------------------|
| chat      | skill-dispatcher         | "review ABC Fuels" / "how is ABC Fuels doing" |
| scheduled | job-trigger              | cron `0 9 ? * MON *` with `from_tenant_config: default_customer` |
| catalog   | `startSkillRun` mutation | Admin UI "Run now" button |

## Tenant overrides

- `inputs.period.default` — flip to `last_quarter` for longer-cadence accounts.
- `triggers.schedule.expression` — different day/time.

Everything else is fixed.

## Relationship to sales-prep

Same four-section shape, different method:

- **Focus hardcoded to `risks`** (not an input).
- **Gather set targets internal telemetry** (product usage, engagement) rather than external signals (web / wiki).
- **Audience is internal** (CSM/AE), not customer-facing.

Changes to the connector contracts (`crm_account_summary`, `ar_summary`, etc.) should pressure-test against both skills — they're the two deliverable anchors in the catalog.

## What this skill does NOT do

- Doesn't call retired helper skills (`frame`, `synthesize`, `gather`, `compound`) — framing + synthesis happen inline in steps 2 and 4.
- Doesn't email or post the report — delivery is a downstream channel.
- Doesn't modify CRM records.
