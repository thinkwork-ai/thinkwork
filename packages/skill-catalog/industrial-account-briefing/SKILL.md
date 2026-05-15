---
name: industrial-account-briefing
display_name: "Industrial Account Briefing"
description: >
  Produce an executive operator briefing from ERP sales, CRM, and fleet
  management context for legacy-industrial accounts.
license: Proprietary
category: briefing
version: "0.1.0"
author: thinkwork
icon: factory
tags: [computer-runbook, erp, crm, fleet, briefing, industrial]
execution: context
allowed-tools:
  - workspace search
  - connected data sources
  - artifact builder
metadata:
  author: thinkwork
  version: "0.1.0"
  thinkwork_kind: computer-runbook
  thinkwork_runbook_contract: references/thinkwork-runbook.json
triggers:
  - "Create an executive operator briefing for this industrial account."
  - "Brief me on account risk using ERP sales, CRM, and fleet data."
  - "Run the industrial account briefing for today's executive review."
---

# Industrial Account Briefing

Use this skill when an executive operator needs a source-grounded briefing across ERP sales, CRM, and fleet-management context. The audience is an operator deciding where attention is needed today, not a sales rep preparing for a call.

Start by reading `references/thinkwork-runbook.json` for routing, confirmation, phases, outputs, and asset contracts. Then load only the phase guidance needed for the active phase.

## Source Families

The briefing expects three source families:

- **ERP sales:** customers, orders, invoices, margin, pricing, branches, territories, products.
- **CRM:** accounts, contacts, opportunities, activities, notes, next steps, relationship owner.
- **Fleet management:** vehicles/assets, utilization, maintenance, dispatch or delivery capacity, service availability, operating cost.

Do not claim a source is live unless the run evidence shows it. If a source family is unavailable, continue with the available evidence and include a source coverage note.

## Briefing Contract

Produce an executive operator view centered on exceptions and action:

- account changes that matter;
- revenue or margin movement;
- stale CRM activity on important accounts;
- fleet or service constraints tied to customers;
- contradictions between systems;
- recommended next actions.

Every material claim must cite the source family and record set behind it. If the available data cannot support a conclusion, say so directly.

Prefer an inspectable artifact when the artifact builder is available. Otherwise return the compact Markdown brief described in `references/produce.md`.

## What This Skill Does Not Do

- Does not modify ERP, CRM, fleet, or catalog records.
- Does not run deterministic ETL pipelines itself.
- Does not infer missing revenue, capacity, or customer facts.
- Does not use the retired OSS connector runtime.
