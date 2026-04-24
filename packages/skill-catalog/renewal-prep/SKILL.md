---
name: renewal-prep
description: >
  Renewal conversation prep — contract terms, usage trends, AR posture,
  renewal history, NPS, support load. Produces a renewal_risk brief
  ordered by deal-impact likelihood. Model drives sub-skill invocation
  via the Skill meta-tool.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
---

# Renewal Prep

Agent-driven renewal-risk brief. The model invokes each sub-skill via
the `Skill(slug, inputs)` meta-tool in the order described below and
degrades gracefully when optional sub-skills are unavailable.

## What a rep gets

A `renewal_risk` Markdown deliverable ordered by which facts most
likely affect renewal outcome: expiring contract terms, usage trend
direction, delinquent AR, recent escalations, NPS softening, pricing
signals. Synthesis uses `focus: "risks"` to keep talking points ordered
by deal-impact likelihood.

## Inputs

| Field            | Required | Type   | Notes |
|------------------|----------|--------|-------|
| `customer`       | Yes      | string | Customer identifier. Resolver: `resolve_customer`. |
| `renewal_date`   | Yes      | date   | Contract renewal / expiry date. |
| `contract_value` | No       | string | Free-form (e.g., `"$120k ARR"`). Rendered into the package template's header. |

## How to run it

Call each step via `Skill(slug, inputs)`. Run the gather sub-skills in
whatever order the runtime prefers — synthesize only needs the merged
result. Skip a gather step if the sub-skill is missing or errors,
except `contract_summary` (see "Degrading gracefully" below).

1. **Frame the goal.** Call `Skill("frame", {problem})` with
   `problem = "Renewal prep for {customer}. Renewal on {renewal_date}. Contract value: {contract_value}."`
   Store as `framed`.
2. **Gather in parallel.** Call these sub-skills and collect successful
   returns into a single `gathered` object keyed by sub-skill name.
   Renewal decisions turn on multiple signals and a missing one can
   mislead — report every footered step to the rep.
   - `contract_summary({customer})` — **required**; if it errors, stop
     and tell the user the contract connector is unavailable. Without
     renewal date / term / auto-renew clause / price there's nothing
     to anchor on.
   - `product_usage_summary({customer, period: "last_quarter"})` —
     optional; footer "Product usage data unavailable" if missing.
   - `renewal_history_summary({customer})` — optional; footer
     "Renewal history unavailable" if missing.
   - `ar_summary({customer})` — optional; footer "AR data unavailable"
     if missing. AR delinquency is a near-deterministic churn signal,
     so call this one out prominently in the rep-facing footer.
   - `nps_summary({customer, period: "last_year"})` — optional; footer
     if missing.
   - `support_incidents_summary({customer, period: "last_quarter"})` —
     optional; footer if missing.
3. **Synthesize.** Call
   `Skill("synthesize", {framed, gathered, focus: "risks"})`. Note
   the hard-coded `focus: "risks"` — renewal prep is a risk-oriented
   exercise; passing a different focus dilutes the signal.
4. **Package.** Call
   `Skill("package", {synthesis, format: "renewal_risk"})` to render
   the final Markdown deliverable with renewal-specific header fields
   (renewal date, contract value).

Implicit before/after:

- Before step 1: `recall` or `hindsight_recall` surfaces prior
  learnings scoped to `(tenant, user, skill, customer)`.
- After step 4: `reflect` or `hindsight_reflect` extracts up to 3 new
  learnings from the run.

## Degrading gracefully

- `contract_summary` is **critical** — a renewal brief anchored on
  missing contract context is worse than none. Abort with a clear user
  message if this step errors or returns empty.
- For every other gather sub-skill: catch the error, record
  `<step-name> unavailable: <reason>` in the deliverable's footer, and
  continue with the remaining context. Call out AR delinquency
  unavailability prominently — it's a near-deterministic churn
  signal the rep must not overlook.
- If `synthesize` fails after a partial gather, don't call `package` —
  return the framed problem + whatever was gathered so the rep can
  triage instead of reading a half-hallucinated brief.

## Scheduling

Daily 07:00 UTC. The default scheduled-job binding reads
`from_tenant_config: upcoming_renewal_customer` — i.e., the tenant owns
the rotation (which account hits the morning brief today). This is the
cleanest separation of concerns: the skill knows *how* to prep a
renewal; the tenant owns the *when*.

## Invocation paths

| Path      | Entry point              | Typical invocation |
|-----------|--------------------------|---------------------|
| chat      | skill-dispatcher         | "prep for ABC Fuels renewal" |
| scheduled | job-trigger              | cron `0 7 * * ? *` with tenant-config bindings |
| catalog   | `startSkillRun` mutation | Admin UI "Run now" button |

## Tenant overrides

Tenants can change `triggers.schedule.expression` — e.g., flip the
07:00 UTC default to a local-timezone morning brief. Nothing else is
overridable. Attempting to pass a config that touches a non-allowlisted
field is rejected at `setAgentSkills` time.

## Relationship to account-health-review

Both are risk-oriented analyses that use the same frame / synthesize /
package sub-skills, but they diverge in three places:

1. **Gather set is deeper** (6 vs 5 sub-skills) and contract-led rather
   than engagement-led.
2. **Template is `renewal_risk`** — the package renders a
   renewal-specific header (renewal date, contract value) and orders
   talking points by deal-impact likelihood, not by general risk
   severity.
3. **Schedule cadence is daily**, not weekly — renewal windows are
   time-sensitive and a weekly cadence misses deals.

Same four primitives (frame / gather / synthesize / package) do the
work; this skill's job is to pick the right gather set, focus hint,
and package template.

## Migration note

This skill was `execution: composition` + 4-step `composition_runner`
YAML through v1.0.0. v2.0.0 migrated to `execution: context` (plan §U8):
the model invokes each sub-skill directly via the Skill meta-tool so
the same renewal workflow no longer needs a separate composition
runtime.
