---
name: renewal-prep
description: >
  Renewal conversation prep — contract terms, usage trends, AR posture,
  renewal history, NPS, support load. Produces a renewal_risk brief
  ordered by deal-impact likelihood.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Renewal Prep Composition

## What a rep gets

A `renewal_risk` Markdown deliverable ordered by which facts most
likely affect renewal outcome: expiring contract terms, usage trend
direction, delinquent AR, recent escalations, NPS softening, pricing
signals. Synthesis uses `focus: risks` to keep the talking points
ordered by deal-impact likelihood.

## Inputs

| Field             | Required | Type   | Notes |
|-------------------|----------|--------|-------|
| `customer`        | Yes      | string | Resolver: `resolve_customer`. |
| `renewal_date`    | Yes      | date   | Contract renewal / expiry. |
| `contract_value`  | No       | string | Free-form (e.g., "$120k ARR"). Rendered into the package template's header. |

## Gather branches

Six branches — the most of any v1 composition. Renewal decisions turn
on multiple signals and a missing one can mislead:

- `contract_summary` (critical) — renewal date, term, auto-renew clause, price
- `product_usage_summary` — last quarter, used as the retention signal
- `renewal_history_summary` — did they expand / hold / shrink at the last two renewals
- `ar_summary` — delinquency is a near-deterministic churn signal
- `nps_summary` — trend over the last year
- `support_incidents_summary` — escalations in the last quarter

Only contract is `critical: true`; everything else degrades with a
footer note. Without contract terms the brief has nothing to anchor
on, so we abort rather than mislead the rep.

## Scheduling

Daily 07:00 UTC. The default scheduled-job binding reads
`from_tenant_config: upcoming_renewal_customer` — i.e., the tenant
owns the rotation (which account hits the morning brief today). This
is the cleanest separation of concerns: the composition knows *how*
to prep a renewal; the tenant owns the *when*.

## Relationship to account-health-review

Both are risk-oriented analyses, but they diverge in three places:

1. **Gather set is deeper** (6 vs 5 branches) and contract-led
   rather than engagement-led.
2. **Template is renewal_risk** — the package renders a
   renewal-specific header (renewal date, contract value) and
   orders talking points by deal-impact likelihood, not by
   general risk severity.
3. **Schedule cadence is daily**, not weekly — renewal windows are
   time-sensitive and a weekly cadence misses deals.

Same four primitives (frame / gather / synthesize / package) do
the work; the YAML's job is to pick the right gather set, focus
hint, and template.
