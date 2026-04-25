---
name: renewal-prep
display_name: "Renewal Prep"
description: >
  Renewal conversation prep — contract terms, usage trends, AR posture,
  renewal history, NPS, support load. Produces a renewal_risk brief
  ordered by deal-impact likelihood.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.1.0"
allowed-tools:
  - render_package
  - hindsight_recall
  - hindsight_reflect
  - contract_summary
  - product_usage_summary
  - renewal_history_summary
  - ar_summary
  - nps_summary
  - support_incidents_summary
version: 2
execution: context
inputs:
  customer:
    type: string
    required: true
    resolver: resolve_customer
    on_missing_input: ask
  renewal_date:
    type: date
    required: true
    on_missing_input: ask
  contract_value:
    type: string
    required: false
tenant_overridable:
  - triggers.schedule.expression
triggers:
  chat_intent:
    examples:
      - "prep for {customer} renewal"
      - "renewal brief for {customer}"
      - "{customer} renewal risk"
    disambiguation: ask
  schedule:
    type: cron
    expression: "0 7 * * ? *"
    bindings:
      customer:
        from_tenant_config: upcoming_renewal_customer
      renewal_date:
        from_tenant_config: upcoming_renewal_date
requires_skills:
  - package
---

# Renewal Prep

You are producing a renewal-risk brief for a rep heading into a renewal conversation with `customer`. The brief is ordered by which facts most likely affect deal outcome: expiring contract terms, usage trend, delinquent AR, recent escalations, NPS softening.

## Inputs

| Field            | Required | Type   | Notes |
|------------------|----------|--------|-------|
| `customer`       | Yes      | string | Customer identifier. |
| `renewal_date`   | Yes      | date   | Contract renewal / expiry date. |
| `contract_value` | No       | string | Free-form (e.g. `"$120k ARR"`). Rendered into the package header. |

## Deliverable shape

Four-section brief produced by `render_package(synthesis=..., format="renewal_risk", metadata=...)`:

- **Risks** — ordered by deal-impact likelihood (AR delinquency first, then usage decline, then escalations, etc.).
- **Opportunities** — re-engagement or expansion levers.
- **Open questions** — what the rep must clarify before the renewal call.
- **Talking points** — the renewal-call agenda, top-down by probability of affecting the outcome.

Cite every finding. Never invent facts.

## Method

### 1. Pull prior learnings

```
hindsight_recall(skill_id="renewal-prep", subject_entity_id=customer)
```

Renewal learnings are often high-signal ("Last year's renewal slipped because we never surfaced the AR past-due"). Let them shape synthesis.

### 2. Scratch-restate the goal

Internal scratchpad (≤150 words):

- **Goal:** Specific renewal picture for `customer`, `renewal_date`, `contract_value`.
- **Constraints:** Rep audience, renewal-conversation framing.
- **Known unknowns:** What you need to resolve before writing.
- **Decision criteria:** Would a rep know what to say first?

### 3. Gather in parallel

Fire these concurrently:

**Critical (abort if it fails):**
- `contract_summary(customer=customer)` — renewal date, term, auto-renew clause, price. Without this the brief has nothing to anchor on.

**Nice-to-have (degrade gracefully — footer note per missing source):**
- `product_usage_summary(customer=customer, period="last_quarter")` — MAU trend, feature adoption.
- `renewal_history_summary(customer=customer)` — prior renewal outcomes, precedents, discount history.
- `ar_summary(customer=customer)` — invoice status, DSO, past-due. **Call out AR delinquency prominently in the footer if this is unavailable** — it's a near-deterministic churn signal.
- `nps_summary(customer=customer, period="last_year")` — NPS trend, detractor themes.
- `support_incidents_summary(customer=customer, period="last_quarter")` — ticket volume, escalations.

If a nice-to-have tool errors: continue with a footer note. For the AR case specifically, add a stronger warning: `> WARNING: AR status unavailable — verify delinquency manually before the call.`

### 4. Synthesize

Focus hardcoded to **risks** for this skill — renewal prep is inherently risk-oriented. Produce the four sections as a single Markdown string with `##` headings in this exact order and spelling — `render_package` embeds your synthesis verbatim:

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

- **Order Risks by deal-impact likelihood.** AR past-due > usage decline > escalations > NPS softening > champion churn. Use the actual gathered data to refine the order.
- **Opportunities stay short.** Re-engagement tactics only; don't pad.
- **Open questions:** What the rep must clarify before the renewal call.
- **Talking points:** Renewal-call agenda, top-down by probability of affecting outcome.

Cite every finding. 400 words max across the four sections.

### 5. Render

```
render_package(
  synthesis=<your four-section Markdown string>,
  format="renewal_risk",
  metadata={"customer": customer, "renewal_date": renewal_date, "contract_value": contract_value}
)
```

Return the rendered Markdown verbatim.

### 6. Reflect

```
hindsight_reflect(
  skill_id="renewal-prep",
  subject_entity_id=customer,
  text="..."
)
```

Up to 3 observations. Skip if nothing new.

## Degrading gracefully

- **Contract critical:** If `contract_summary` errors or returns empty, stop. Tell the user the contract connector is unavailable.
- **AR unavailability warrants a stronger footer than other missing sources** — call it out explicitly in bold.
- **Synthesis failure after partial gather:** Skip render, return the scratchpad + gathered data so the rep can triage.

## Scheduling

Default: daily 07:00 UTC. The scheduled-job binding reads `from_tenant_config: upcoming_renewal_customer` — tenants own the rotation (which account gets the morning brief today). This is the cleanest separation: the skill knows *how* to prep, the tenant owns the *when*.

## Invocation paths

| Path      | Entry point              | Typical invocation |
|-----------|--------------------------|---------------------|
| chat      | skill-dispatcher         | "prep for ABC Fuels renewal" |
| scheduled | job-trigger              | cron `0 7 * * ? *` with tenant-config bindings |
| catalog   | `startSkillRun` mutation | Admin UI "Run now" button |

## Tenant overrides

Only `triggers.schedule.expression` — local-timezone morning brief, etc. Nothing else.

## Relationship to sales-prep / account-health-review

All three share the four-section shape, but:

- **sales-prep:** general meeting prep, external signals (web / wiki), `sales_brief` template.
- **account-health-review:** periodic internal review, engagement telemetry, `health_report` template, weekly cadence.
- **renewal-prep (this skill):** contract-anchored, deal-impact ordering, `renewal_risk` template, daily cadence.

Connector changes should pressure-test against all three.

## What this skill does NOT do

- Doesn't call retired helper skills (`frame`, `synthesize`, `gather`, `compound`).
- Doesn't email/slack the brief.
- Doesn't modify CRM, contract, or AR records.
- Doesn't schedule follow-ups.
