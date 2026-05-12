---
name: crm-dashboard
display_name: "CRM Dashboard"
description: >
  Build an opinionated CRM dashboard app that surfaces pipeline health, account risk, next actions, and evidence.
license: Proprietary
category: dashboard
version: "0.1.0"
author: thinkwork
icon: layout-dashboard
tags: [computer-runbook, crm, dashboard, sales]
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
  - "Build a CRM pipeline risk dashboard for LastMile opportunities."
  - "Create a sales dashboard showing account health and next actions."
  - "Run the CRM dashboard runbook for this customer list."
---

# CRM Dashboard

Use this skill when the user wants an inspectable CRM, sales, pipeline, renewal, opportunity, account-health, or customer-risk dashboard artifact.

Start by reading `references/thinkwork-runbook.json` for routing, confirmation, phase, output, and asset contracts. Then load only the phase guidance needed for the current phase.

Follow the phase order unless the active run snapshot tells you otherwise: discover CRM context, analyze pipeline and account risk, produce the dashboard artifact, then validate the result. Keep claims grounded in source data or label them as assumptions.

When producing the artifact, use `assets/crm-dashboard-data.schema.json` and the produce-phase guidance to shape the saved app.
