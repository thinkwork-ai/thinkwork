---
name: sales-prep
description: >
  Produce a pre-meeting brief for a sales rep covering account context,
  financials, open incidents, external signals, and talking points.
  Chat / schedule / catalog / webhook anchor for the deliverable-shape
  skill pattern.
license: Proprietary
metadata:
  author: thinkwork
  version: "2.1.0"
allowed-tools:
  - render_package
  - hindsight_recall
  - hindsight_reflect
  - web_search
  - search_wiki
  - crm_account_summary
  - ar_summary
  - support_incidents_summary
---

# Sales Prep

You are producing a Markdown brief that a sales rep reads in 60 seconds before a meeting with `customer` on `meeting_date`. The deliverable has a fixed shape; this document is the contract + method.

## Inputs

| Field          | Required | Type  | Notes |
|----------------|----------|-------|-------|
| `customer`     | Yes      | string | Customer identifier. |
| `meeting_date` | Yes      | date  | ISO-8601. |
| `focus`        | No       | enum  | `financial` \| `expansion` \| `risks` \| `general`. Default `general`. |

## Deliverable shape

The rep gets a Markdown brief with four sections, in this order:

- **Risks** — pulled from CRM, AR, and support signals.
- **Opportunities** — expansion signals from usage, web, and wiki.
- **Open questions** — things the rep should resolve pre-meeting.
- **Talking points** — ordered most-to-least important for the focus.

Every finding cites its source (e.g. `CRM: ARR $380k, renewal 2026-Q2`). **Never invent facts.** If you don't have a source, put it in Open questions, not Risks or Opportunities.

The final output is produced by `render_package(synthesis=..., format="sales_brief", metadata=...)` — that tool wraps your Markdown synthesis in the canonical template (header, meeting date, etc.).

## Method

### 1. Pull prior learnings (before anything else)

```
hindsight_recall(skill_id="sales-prep", subject_entity_id=customer)
```

These are things past runs for this customer taught you — preferences, gotchas, corrections. Weight them heavily in your synthesis.

### 2. Scratch-restate the goal

Write a one-paragraph scratchpad (do NOT include it in the deliverable) with four labeled lines:

- **Goal:** What a good brief looks like for this specific customer + meeting_date + focus.
- **Constraints:** Time-to-read, tone, data sensitivity, anything else the brief must respect.
- **Known unknowns:** Facts you need to resolve before writing.
- **Decision criteria:** How the rep will judge the brief good enough.

Keep this under 150 words. It's internal, not part of the output.

### 3. Gather in parallel

Fire these tool calls concurrently — don't wait on one before starting the next:

**Critical (abort if it fails):**
- `crm_account_summary(customer=customer)` — ARR, renewal date, AE, last activity. Without this the brief has nothing to anchor on.

**Nice-to-have (degrade gracefully — note absence in a footer):**
- `ar_summary(customer=customer)` — invoice status, DSO, past-due amounts.
- `support_incidents_summary(customer=customer)` — open tickets, NPS.
- `web_search(query="<customer name> news 2026")` — recent public signals.
- `search_wiki(query=customer)` — tenant-specific notes.

If a nice-to-have tool errors, isn't registered, or returns empty: continue. At the end of the deliverable add a footer line per missing source, e.g. `> Note: support data unavailable.`

### 4. Synthesize

Reading the gathered data alongside the `focus` parameter, produce the four sections as a single Markdown string with `##` headings in this exact order and spelling — `render_package` embeds your synthesis verbatim:

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
- **Focus `risks`** → lead with Risks; keep Opportunities short.
- **Focus `expansion`** → lead with Opportunities; surface usage trends.
- **Focus `financial`** → put ARR / renewal posture / AR in Risks and Opportunities.
- **Focus `general`** (default) → balance all four sections.
- Cite every finding.
- Specific numbers over adjectives.
- 400 words max across the four sections.
- Don't promote Known unknowns from step 2 into Risks unless you confirm a negative signal — they belong in Open questions.

### 5. Render

```
render_package(
  synthesis=<your four-section Markdown string>,
  format="sales_brief",
  metadata={"customer": customer, "meeting_date": meeting_date, "focus": focus}
)
```

Return the rendered Markdown as your final output. Do not reformat it — `render_package` produced the canonical shape.

### 6. Reflect

If you learned something non-obvious about this customer — a preferred source, a correction, a recurring pattern — call `hindsight_reflect` with up to 3 observations:

```
hindsight_reflect(
  skill_id="sales-prep",
  subject_entity_id=customer,
  text="..."
)
```

Skip this step if the run didn't surface anything new.

## Connector dependencies

The gather step calls connector tools that ship in separate PRDs:

- `crm_account_summary` — CRM adapter (Salesforce / HubSpot / etc.)
- `ar_summary` — ERP / billing adapter.
- `support_incidents_summary` — helpdesk adapter.
- `web_search` — shipped.
- `search_wiki` — shipped.

If a connector isn't registered in the current session's tool set, the tool call fails cleanly and step 3's graceful-degradation footer kicks in.

## Tenant overrides

Tenants can change these via the `tenant_overridable` allowlist (see `skill.yaml`):

- `inputs.focus.default` — a renewals-heavy tenant might flip to `risks`.
- `triggers.schedule.expression` — afternoon brief → morning brief, etc.

Everything else is fixed. Attempting to override an unlisted field is rejected at `setAgentSkills` time.

## What this skill does NOT do

- Doesn't send the brief (email/slack is a separate delivery channel).
- Doesn't schedule follow-ups (use `schedule_followup` tool separately).
- Doesn't modify CRM records.
- Doesn't call retired helper skills (`frame`, `synthesize`, `gather`, `compound`) — framing + synthesis happen inline in steps 2 and 4.
