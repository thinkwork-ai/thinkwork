---
name: account-health-review
description: >
  Periodic review of customer health signals. Aggregates engagement,
  usage, AR posture, support load, and CRM notes over a configurable
  window; produces a health_report deliverable.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Account Health Review Composition

## What a CSM / AE gets

A `health_report` Markdown deliverable with Risks / Opportunities /
Open questions / Talking points — same shape as sales-prep, but the
synthesis is steered toward `focus: risks` and the gather set swaps
in product-usage + engagement signals instead of web + wiki research.

## Inputs

| Field          | Required | Type   | Notes |
|----------------|----------|--------|-------|
| `customer`     | Yes      | string | Resolver: `resolve_customer`. |
| `period`       | No       | enum   | `last_30_days` \| `last_quarter` \| `last_year`. Default `last_30_days`. |
| `agent_name`   | No       | string | Optional; passed to the package template. |

## Gather branches

- `crm_account_summary` (critical) — account status + owner + recent notes
- `product_usage_summary` — DAU/WAU trends, feature adoption
- `ar_summary` — outstanding invoices, payment posture
- `support_incidents_summary` — ticket volume + severity mix
- `engagement_summary` — email/meeting frequency with account contacts

Per-branch failures footer gracefully; CRM is critical because
everything else references it.

## Scheduling

Default: weekly, Monday 09:00. Tenants typically override the expression
to match their standing-meeting rhythm (e.g., Thursday morning for QBR
prep teams). The `from_tenant_config: default_customer` binding lets a
tenant point the weekly review at a rotating focus account without
re-authoring the schedule.

## Relationship to sales-prep

Similar shape (frame / gather / synthesize / package) with two deliberate
differences:

1. **Focus hint is `risks`**, not passed through from inputs. Health
   reviews are inherently risk-oriented; passing `focus: general` here
   would dilute the signal.
2. **Gather reaches product + engagement telemetry**, not outside-the-firewall
   signals (web / wiki). The review audience is the internal team, not
   the customer-facing conversation.

Changes to the shared `frame` / `synthesize` / `package` primitives
should pressure-test against both sales-prep and account-health-review —
they're the two deliverable-shaped anchors.
