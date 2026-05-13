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

## Artifact UI Contract

When producing or updating the artifact, load `references/produce.md` and treat its UI contract as mandatory. The saved `App.tsx` must be a dense operational dashboard built with the platform component libraries, not a markdown report, prose summary, or custom HTML layout.

Use shadcn-compatible primitives from `@thinkwork/ui` for dashboard layout and controls: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `ScrollArea`, and `Separator` where applicable.

Use `@thinkwork/computer-stdlib` for semantic app primitives and data visualization: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`.

Do not hand-roll cards, tabs, badges, buttons, or tables. Tabs must use `Tabs`; status labels must use `Badge`; metric panels must use `Card` or `KpiStrip`; tabular data must use `DataTable` or `Table`. Use real chart or table components for stage exposure, stale activity, risks, rep concentration, and opportunities.

Do not use emoji as icons, status markers, bullets, tab labels, headings, or decorative text. If an icon is useful, import it from `lucide-react` or `@tabler/icons-react`; otherwise use text labels and badges.

Before calling `save_app`, inspect the generated TSX. If it does not import `@thinkwork/ui`, use real dashboard components, include meaningful KPI/chart/table sections, and avoid emoji, revise it before saving.

Use `assets/crm-dashboard-data.schema.json` and the produce-phase guidance to shape the saved app.
