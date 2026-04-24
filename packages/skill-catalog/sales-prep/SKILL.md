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
  version: "2.0.0"
allowed-tools:
  - Skill
  - recall
  - reflect
  - web_search
  - wiki_search
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

The final output is produced by `Skill("package", {format: "sales_brief", synthesis: <your analysis>})` — that tool deterministically renders the four sections into the canonical template.

## Method

### 1. Pull prior learnings (before anything else)

```
recall({skill_id: "sales-prep", subject_entity_id: customer})
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
- `Skill("crm_account_summary", {customer})` — ARR, renewal date, AE, last activity. Without this the brief has nothing to anchor on.

**Nice-to-have (degrade gracefully — note absence in a footer):**
- `Skill("ar_summary", {customer})` — invoice status, DSO, past-due amounts.
- `Skill("support_incidents_summary", {customer})` — open tickets, NPS.
- `web_search({query: "<customer name> news 2026"})` — recent public signals.
- `wiki_search({query: customer})` — tenant-specific notes.

If a nice-to-have tool errors, isn't registered, or returns empty: continue. At the end of the deliverable add a footer line per missing source, e.g. `> Note: support data unavailable.`

### 4. Synthesize

Reading the gathered data alongside the `focus` parameter, produce the four sections:

- **Focus `risks`** → lead with Risks; keep Opportunities short.
- **Focus `expansion`** → lead with Opportunities; surface usage trends.
- **Focus `financial`** → put ARR / renewal posture / AR in Risks and Opportunities.
- **Focus `general`** (default) → balance all four sections.

Rules:
- Cite every finding.
- Specific numbers over adjectives.
- 400 words max across the four sections.
- Don't promote Known unknowns from step 2 into Risks unless you confirm a negative signal — they belong in Open questions.

### 5. Render

```
Skill("package", {
  format: "sales_brief",
  synthesis: {
    risks: [...],
    opportunities: [...],
    open_questions: [...],
    talking_points: [...]
  },
  metadata: { customer, meeting_date, focus }
})
```

Return the rendered Markdown as your final output. Do not reformat it — `package` produced the canonical shape.

### 6. Reflect

If you learned something non-obvious about this customer — a preferred source, a correction, a recurring pattern — call `reflect` with up to 3 observations:

```
reflect({
  skill_id: "sales-prep",
  subject_entity_id: customer,
  text: "..."
})
```

Skip this step if the run didn't surface anything new.

## Connector dependencies

The gather step calls connector skills that ship in separate PRDs:

- `crm_account_summary` — CRM adapter (Salesforce / HubSpot / etc.)
- `ar_summary` — ERP / billing adapter.
- `support_incidents_summary` — helpdesk adapter.
- `web_search` — shipped.
- `wiki_search` — shipped.

If a connector is not registered in the current session allowlist, the call fails cleanly and step 3's graceful-degradation footer kicks in.

## Tenant overrides

Tenants can change these via the `tenant_overridable` allowlist (see `skill.yaml`):

- `inputs.focus.default` — a renewals-heavy tenant might flip to `risks`.
- `triggers.schedule.expression` — afternoon brief → morning brief, etc.

Everything else is fixed. Attempting to override an unlisted field is rejected at `setAgentSkills` time.

## What this skill does NOT do

- Doesn't send the brief (email/slack is a separate delivery channel).
- Doesn't schedule follow-ups (use `schedule_followup` tool separately).
- Doesn't modify CRM records.
- Doesn't call retired helper skills (`frame`, `synthesize`, `gather`, `compound`) — the framing + analysis happen inline in steps 2 and 4.
