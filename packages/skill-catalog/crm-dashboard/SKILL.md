---
name: crm-dashboard
display_name: "CRM Dashboard"
description: >
  Quickly build an opinionated CRM dashboard app from available CRM data.
license: Proprietary
category: dashboard
version: "0.3.0"
author: thinkwork
icon: layout-dashboard
tags: [crm, dashboard, sales]
execution: context
allowed-tools:
  - workspace search
  - connected data sources
  - artifact builder
metadata:
  author: thinkwork
  version: "0.3.0"
triggers:
  - "Build a CRM pipeline risk dashboard for LastMile opportunities."
  - "Create a sales dashboard showing account health and next actions."
  - "Show me a CRM dashboard for this customer list."
---

# CRM Dashboard

Use this skill when the user wants an inspectable CRM, sales, pipeline, renewal, opportunity, account-health, or customer-risk dashboard artifact.

This skill composes with the `artifact-builder` skill — that skill owns the general artifact-build mechanics (`preview_app`, `save_app`, shadcn registry, TSX validation, component contracts). This skill adds the CRM-specific data fetching, layout, and component guidance on top.

## How to use it

1. Follow the `artifact-builder` skill's contract for all artifact mechanics (preview, save, shadcn primitives, component approvals).
2. Use `references/discover.md` to scope the data fetch — narrow CRM source query, compact data shape, no broad workspace searches when a connected source can answer.
3. Use `references/produce.md` as the binding UI contract for the saved dashboard — KPI strip from `@thinkwork/computer-stdlib`, real chart/table components for stage exposure / stale activity / risks / opportunities, no hand-rolled cards or grids.
4. Use `assets/crm-dashboard-data.schema.json` to shape the saved app's data structure.

If `save_app` fails once, report the concrete error and stop instead of regenerating repeatedly.
