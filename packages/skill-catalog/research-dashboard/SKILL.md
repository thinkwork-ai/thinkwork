---
name: research-dashboard
display_name: "Research Dashboard"
description: >
  Build a general-purpose research dashboard that turns gathered evidence into an inspectable artifact.
license: Proprietary
category: research
version: "0.2.0"
author: thinkwork
icon: search-check
tags: [research, dashboard, evidence]
execution: context
allowed-tools:
  - workspace search
  - connected data sources
  - artifact builder
metadata:
  author: thinkwork
  version: "0.2.0"
triggers:
  - "Build a research dashboard comparing these vendors."
  - "Create an evidence dashboard for supplier risk."
  - "Turn this research into a dashboard I can inspect."
---

# Research Dashboard

Use this skill when the user wants gathered evidence, comparisons, source-backed findings, risks, or caveats turned into an inspectable dashboard artifact.

This skill composes with the `artifact-builder` skill — that skill owns the general artifact-build mechanics (`preview_app`, `save_app`, shadcn registry, TSX validation, component contracts). This skill adds the research-evidence layout, source-attribution components, and confidence/caveat-indicator guidance on top.

## How to use it

1. Follow the `artifact-builder` skill's contract for all artifact mechanics.
2. Use `references/discover.md` to scope the evidence gathering. Preserve uncertainty and keep source-backed facts distinct from inference.
3. Use `references/produce.md` for the dashboard structure — findings/entities grouped by relevant dimension, source-backed claims with confidence indicators, filters and drill-in tables that let the user inspect rather than read a static report.
4. Use `assets/research-dashboard-layout.json` for output-shaping guidance.
