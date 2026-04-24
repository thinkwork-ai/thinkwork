---
name: account-health-review
description: >
  Periodic review of customer health signals. Aggregates engagement,
  usage, AR posture, support load, and CRM notes over a configurable
  window; produces a health_report deliverable. Model drives sub-skill
  invocation via the Skill meta-tool.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
---

# Account Health Review

Agent-driven risk-focused review. The model invokes each sub-skill via
the `Skill(slug, inputs)` meta-tool in the order described below and
degrades gracefully when optional sub-skills are unavailable.

## What a CSM / AE gets

A `health_report` Markdown deliverable with Risks / Opportunities /
Open questions / Talking points — same shape as `sales-prep`, but the
synthesis is steered toward `focus: risks` and the gather set swaps in
product-usage + engagement signals instead of web + wiki research.

## Inputs

| Field        | Required | Type   | Notes |
|--------------|----------|--------|-------|
| `customer`   | Yes      | string | Customer identifier. Resolver: `resolve_customer`. |
| `period`     | No       | enum   | `last_30_days` \| `last_quarter` \| `last_year`. Default `last_30_days`. |
| `agent_name` | No       | string | Optional; passed to the `package` template. |

## How to run it

Call each step via `Skill(slug, inputs)`. Run the gather sub-skills in
whatever order the runtime prefers — synthesize only needs the merged
result. Skip a gather step if the sub-skill is missing or errors,
except `crm_account_summary` (see "Degrading gracefully" below).

1. **Frame the goal.** Call `Skill("frame", {problem})` with
   `problem = "Account health review for {customer} over {period}."`
   Store as `framed`.
2. **Gather in parallel.** Call these sub-skills with `{customer}` (and
   `{period}` where noted). Collect successful returns into a single
   `gathered` object keyed by sub-skill name.
   - `crm_account_summary({customer, period})` — **required for a
     useful review**; if it errors, stop here and tell the user the CRM
     connector is unavailable. Don't fabricate account context.
   - `product_usage_summary({customer, period})` — optional; footer
     "Product usage data unavailable" if missing.
   - `ar_summary({customer})` — optional; footer "AR data unavailable"
     if missing.
   - `support_incidents_summary({customer, period})` — optional; footer
     "Support data unavailable" if missing.
   - `engagement_summary({customer, period})` — optional; footer
     "Engagement data unavailable" if missing.
3. **Synthesize.** Call
   `Skill("synthesize", {framed, gathered, focus: "risks"})`. Note
   the hard-coded `focus: "risks"` — health reviews are inherently
   risk-oriented; passing a different focus dilutes the signal.
4. **Package.** Call
   `Skill("package", {synthesis, format: "health_report"})` to render
   the final Markdown deliverable.

Implicit before/after:

- Before step 1: `recall` (managed memory) or `hindsight_recall` (when
  Hindsight is enabled) surfaces prior learnings scoped to
  `(tenant, user, skill, customer)`.
- After step 4: `reflect` or `hindsight_reflect` extracts up to 3 new
  learnings from the run and stores them under the same scope.

## Degrading gracefully

- `crm_account_summary` is **critical** — a health review anchored on
  missing CRM context is worse than none. Abort with a clear user
  message if this step errors or returns empty.
- For every other gather sub-skill: catch the error, record
  `<step-name> unavailable: <reason>` in the deliverable's footer, and
  continue with the remaining context.
- If `synthesize` fails after a partial gather, don't call `package` —
  return the framed problem + whatever was gathered so the CSM can
  triage instead of reading a half-hallucinated report.

## Scheduling

Default: weekly, Monday 09:00. Tenants typically override the
expression to match their standing-meeting rhythm (e.g., Thursday
morning for QBR prep teams). The `from_tenant_config: default_customer`
binding lets a tenant point the weekly review at a rotating focus
account without re-authoring the schedule.

## Invocation paths

| Path      | Entry point              | Typical invocation |
|-----------|--------------------------|---------------------|
| chat      | skill-dispatcher         | "review ABC Fuels" / "how is ABC Fuels doing" |
| scheduled | job-trigger              | cron `0 9 ? * MON *` with `from_tenant_config: default_customer` |
| catalog   | `startSkillRun` mutation | Admin UI "Run now" button |

## Tenant overrides

Tenants can change these per the `tenant_overridable` allowlist:

- `inputs.period.default` — flip to `last_quarter` for teams with
  longer-cadence relationships.
- `triggers.schedule.expression` — flip the cron for a team that runs
  health reviews on a different day / time.

Nothing else is overridable. Attempting to pass a config that touches a
non-allowlisted field is rejected at `setAgentSkills` time.

## Relationship to sales-prep

Similar shape (frame / gather / synthesize / package) with two
deliberate differences:

1. **Focus hint is `risks`**, hard-coded in step 3. Health reviews are
   inherently risk-oriented.
2. **Gather reaches product + engagement telemetry**, not
   outside-the-firewall signals (web / wiki). The review audience is
   the internal team, not customer-facing conversation.

Changes to the shared `frame` / `synthesize` / `package` sub-skills
should pressure-test against both — they're the two deliverable-shaped
anchors in the catalog.

## Migration note

This skill was `execution: composition` + 4-step `composition_runner`
YAML through v1.0.0. v2.0.0 migrated to `execution: context` (plan §U8):
the model invokes each sub-skill directly via the Skill meta-tool so
the same health-review workflow no longer needs a separate composition
runtime.
