---
name: research-dashboard
display_name: "Research Dashboard"
description: >
  Build a general-purpose research dashboard that turns gathered evidence into an inspectable artifact.
license: Proprietary
category: research
version: "0.1.0"
author: thinkwork
icon: search-check
tags: [computer-runbook, research, dashboard, evidence]
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
  - "Build a research dashboard comparing these vendors."
  - "Create an evidence dashboard for supplier risk."
  - "Turn this research into a dashboard I can inspect."
---

# Research Dashboard

Use this skill when the user wants gathered evidence, comparisons, source-backed findings, risks, or caveats turned into an inspectable dashboard artifact.

Start by reading `references/thinkwork-runbook.json` for routing, confirmation, phase, output, and asset contracts. Then load only the phase guidance needed for the current phase.

Follow the phase order unless the active run snapshot tells you otherwise: discover evidence, synthesize findings, produce the dashboard artifact, then validate evidence and caveats. Preserve uncertainty and keep source-backed facts distinct from inference.

When producing the artifact, use `assets/research-dashboard-layout.json` as output-shaping guidance for the dashboard structure.
