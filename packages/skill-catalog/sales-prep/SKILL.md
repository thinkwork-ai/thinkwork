---
name: sales-prep
description: >
  Pre-meeting brief for a sales rep. One input (customer + meeting date +
  focus) produces a packaged deliverable covering account context,
  financials, open tickets, external signals, and customer-specific wiki
  notes. Chat/schedule/catalog anchor for the composable-skills DSL.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Sales Prep Composition

## What a rep gets

A Markdown brief with four sections rendered by the `package` primitive's
`sales_brief` template:

- **Risks** — drawn from CRM + AR + support incidents
- **Opportunities** — expansion signals from usage + web + wiki
- **Open questions** — things the rep should resolve pre-meeting
- **Talking points** — ordered most-to-least important for the
  meeting's stated focus

Each section carries citations back to the gather branch that surfaced
the fact — no hallucinated claims.

## Inputs

| Field          | Required | Type  | Notes |
|----------------|----------|-------|-------|
| `customer`     | Yes      | string | Customer identifier. Resolver: `resolve_customer`. |
| `meeting_date` | Yes      | date  | ISO-8601 date of the meeting. |
| `focus`        | No       | enum  | `financial` \| `expansion` \| `risks` \| `general`. Default `general`. |

## How it runs

1. **frame** — restates the request as `{ goal, constraints, known unknowns,
   decision criteria }`. Gives the downstream steps a concrete target.
2. **gather** (parallel, 5 branches) — CRM, AR, tickets, web, wiki. The
   CRM branch is `critical: true` — if it fails the whole run aborts.
   The other four degrade gracefully via `on_branch_failure: continue_with_footer`.
3. **synthesize** — reads framed + gathered + focus, produces the
   four-section analysis.
4. **package** — deterministically renders the sales_brief template.

Implicit before/after:
- Before step 1: `compound.recall` injects prior learnings scoped to
  (tenant, user, skill, customer) when the runner has the caller's scope.
- After step 4: `compound.reflect` extracts up to 3 new learnings from
  the run and stores them under the same scope.

## Invocation paths

| Path      | Entry point               | Typical invocation              |
|-----------|---------------------------|--------------------------------- |
| chat      | skill-dispatcher          | "prep me for ABC Fuels Thursday" |
| scheduled | job-trigger (Unit 6)      | cron `0 14 ? * MON-FRI *` with `from_tenant_config: default_customer` |
| catalog   | startSkillRun mutation    | Admin UI "Run now" button (Unit 7 surface) |
| webhook   | (not wired)               | Deliverable-shaped skills don't reach here |

## Tenant overrides

Tenants can change these per the `tenant_overridable` allowlist:

- `inputs.focus.default` — e.g., a tenant that cares only about renewals
  can set default to `risks`.
- `triggers.schedule.expression` — e.g., the afternoon brief becomes a
  morning brief by flipping to `0 8 ? * MON-FRI *`.

Nothing else is overridable. Attempting to pass a config that touches a
non-allowlisted field is rejected at `setAgentSkills` time.

## Connector dependencies

The five gather branches call connector skills that live in separate PRDs:

- `crm_account_summary` — single-tenant CRM adapter (Salesforce, HubSpot, etc.)
- `ar_summary` — ERP/billing adapter
- `support_incidents_summary` — helpdesk adapter
- `web_research` — already shipped (web-search skill family)
- `wiki_search` — already shipped (wiki tools)

If a connector is missing at launch, the `on_branch_failure:
continue_with_footer` policy renders a footer note in the deliverable
("CRM data unavailable") instead of failing the whole composition. The
one exception is the CRM branch's `critical: true` — without CRM context
the brief has nothing to anchor on, so we abort rather than mislead.
