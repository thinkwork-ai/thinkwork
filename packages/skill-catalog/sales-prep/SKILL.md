---
name: sales-prep
description: >
  Pre-meeting brief for a sales rep. One input (customer + meeting date +
  focus) produces a packaged deliverable covering account context,
  financials, open tickets, external signals, and customer-specific wiki
  notes. Model drives sub-skill invocation via the Skill meta-tool.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.0.0"
---

# Sales Prep

Agent-driven multi-step brief for a sales rep. The model invokes each
sub-skill via the `Skill(slug, inputs)` meta-tool in the order described
below and degrades gracefully when optional sub-skills are unavailable.

## What a rep gets

A Markdown brief with four sections rendered by the `package` sub-skill's
`sales_brief` template:

- **Risks** — drawn from CRM + AR + support incidents.
- **Opportunities** — expansion signals from usage + web + wiki.
- **Open questions** — things the rep should resolve pre-meeting.
- **Talking points** — ordered most-to-least important for the
  meeting's stated focus.

Each section carries citations back to the sub-skill call that surfaced
the fact — no hallucinated claims.

## Inputs

| Field          | Required | Type   | Notes |
|----------------|----------|--------|-------|
| `customer`     | Yes      | string | Customer identifier. Resolver: `resolve_customer`. |
| `meeting_date` | Yes      | date   | ISO-8601 date of the meeting. |
| `focus`        | No       | enum   | `financial` \| `expansion` \| `risks` \| `general`. Default `general`. |

## How to run it

Call each step via `Skill(slug, inputs)`. Run the gather sub-skills in
whatever order the runtime prefers — the synthesize step only needs the
merged result, not a specific ordering. Skip a gather step if the
sub-skill is missing or returns an error, except `crm_account_summary`
(see "Degrading gracefully" below).

1. **Frame the goal.** Call `Skill("frame", {problem})` with
   `problem = "Prep for meeting with {customer} on {meeting_date}. Focus: {focus}."`
   Store the return as `framed`.
2. **Gather in parallel.** Call these sub-skills with `{customer}` (and
   `{meeting_date}` where noted). Collect successful returns into a
   single `gathered` object keyed by sub-skill name.
   - `crm_account_summary(customer)` — **required for a useful brief**;
     if it errors, stop here and tell the user the CRM connector is
     unavailable. Don't fabricate account context.
   - `ar_summary(customer)` — optional; footer "AR data unavailable"
     if missing.
   - `support_incidents_summary(customer)` — optional; footer
     "Support data unavailable" if missing.
   - `web-search({query: customer, date: meeting_date})` — optional.
   - `wiki_search({query: customer})` — optional.
3. **Synthesize.** Call
   `Skill("synthesize", {framed, gathered, focus})`. Store as
   `synthesis`.
4. **Package.** Call
   `Skill("package", {synthesis, format: "sales_brief"})` to render the
   final Markdown deliverable.

Implicit before/after:

- Before step 1: `recall` (managed memory) or `hindsight_recall` (when
  Hindsight is enabled) surfaces prior learnings scoped to
  `(tenant, user, skill, customer)`.
- After step 4: `reflect` or `hindsight_reflect` extracts up to 3 new
  learnings from the run and stores them under the same scope.

## Degrading gracefully

- `crm_account_summary` is **critical** — an account brief anchored on
  missing CRM context is worse than no brief. Abort with a clear user
  message if this step errors or returns empty.
- For every other gather sub-skill: catch the error, record
  `<step-name> unavailable: <reason>` in the deliverable's footer, and
  continue with the remaining context.
- If `synthesize` fails after a partial gather, don't call `package` —
  return the framed problem + whatever was gathered so the rep can
  triage instead of reading a half-hallucinated brief.

## Invocation paths

| Path      | Entry point              | Typical invocation |
|-----------|--------------------------|---------------------|
| chat      | skill-dispatcher         | "prep me for ABC Fuels Thursday" |
| scheduled | job-trigger              | cron `0 14 ? * MON-FRI *` with `from_tenant_config: default_customer` |
| catalog   | `startSkillRun` mutation | Admin UI "Run now" button |

## Tenant overrides

Tenants can change these per the `tenant_overridable` allowlist:

- `inputs.focus.default` — e.g., a tenant that cares only about renewals
  can set default to `risks`.
- `triggers.schedule.expression` — e.g., the afternoon brief becomes a
  morning brief by flipping to `0 8 ? * MON-FRI *`.

Nothing else is overridable. Attempting to pass a config that touches a
non-allowlisted field is rejected at `setAgentSkills` time.

## Connector dependencies

The gather steps call connector skills that live in separate PRDs:

- `crm_account_summary` — single-tenant CRM adapter.
- `ar_summary` — ERP/billing adapter.
- `support_incidents_summary` — helpdesk adapter.
- `web-search` — already shipped.
- `wiki_search` — already shipped (wiki tools).

## Migration note

This skill was `execution: composition` + 5-step `composition_runner`
YAML through v1.0.0. v2.0.0 migrated to `execution: context` (plan §U8):
the model invokes each sub-skill directly via the Skill meta-tool so
the same pre-meeting workflow no longer needs a separate composition
runtime.
