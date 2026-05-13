# Produce dashboard artifact

Build an interactive dashboard artifact with a clear CRM information architecture: summary metrics, pipeline/risk breakdowns, entity-level tables or lists, and focused drill-in sections. Favor scan-friendly operational density over a marketing-style layout.

Use the Artifact Builder compatibility shim only as the implementation mechanism. The runbook owns the phase order and task queue; this phase owns the saved dashboard artifact.

The saved artifact must look and behave like a dashboard app, not a markdown report, prose summary, or text-only list. Treat the LastMile CRM dashboard pattern as the quality bar: a dense operational surface with strong metric hierarchy, real chart/table views, compact controls, and clear status badges. Do not ship a stack of bordered text blocks.

Normalize source results into `CrmDashboardData` before writing TSX:

```ts
type SourceStatus = "success" | "partial" | "failed";
type RiskLevel = "high" | "medium" | "low";

interface CrmDashboardData {
  snapshot: {
    title: string;
    summary: string;
    generatedAt: string;
    accountFilter?: string;
  };
  kpis: Array<{
    id: string;
    label: string;
    value: string;
    detail?: string;
    tone?: "default" | "risk" | "success";
  }>;
  stageExposure: Array<{ label: string; value: number; count: number }>;
  staleActivity: Array<{ label: string; value: number; count: number }>;
  topRisks: Array<{
    id: string;
    opportunity: string;
    account: string;
    stage: string;
    amount: number;
    lastActivity?: string;
    risk: RiskLevel;
    reason: string;
    nextStep?: string;
  }>;
  opportunities: Array<{
    id?: string;
    opportunity: string;
    account: string;
    stage: string;
    amount: number;
    owner?: string;
    closeDate?: string;
    lastActivity?: string;
    risk?: RiskLevel;
  }>;
  refreshNote?: string;
}
```

Build the app body only. The Computer host provides Artifact chrome, route title, app label, open-full action, refresh action placement, and iframe wrapper. Do not duplicate that shell inside `App.tsx`.

Use shadcn-compatible primitives from `@thinkwork/ui` for layout and controls: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `ScrollArea`, and `Separator` where applicable. This is a hard requirement for CRM dashboard artifacts. If the generated TSX does not import `@thinkwork/ui`, revise it before calling `save_app`.

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`. At minimum, include KPI cards, stage exposure, stale activity, top risks, and an opportunity table or list. Keep missing-source notes proportional and close to affected metrics.

Visual contract for CRM dashboards:

- Do not hand-roll cards, tabs, badges, buttons, or tables. Tabs must use `Tabs`/`TabsList`/`TabsTrigger`; tabular data must use `DataTable` or `Table`; status labels must use `Badge`; metric panels must use `Card` or `KpiStrip`. Raw `<table>`, `<button>`, and dashboard cards made from plain `<div>` elements are not acceptable.
- Use at least two visual/data primitives from `@thinkwork/computer-stdlib`, normally `KpiStrip` plus `BarChart`, `StackedBarChart`, or `DataTable`.
- Use real chart or table components for comparisons; do not render stage exposure, stale activity, rep concentration, or opportunities as plain paragraphs.
- Start with a compact dashboard header/status row and KPI strip, then place charts and tables in a responsive grid. Keep the first viewport useful.
- Use tabs, segmented controls, sorting buttons, or filters when the requested scope has multiple analytical views.
- Keep caveats and source notes short and adjacent to the affected metric; do not dedicate large app sections to provenance unless the user explicitly asks.
- Use restrained CRM-dashboard color accents for value, risk, stale activity, and success. Avoid one-note monochrome layouts.
- Do not use emoji as icons, status markers, bullets, tab labels, or headings. If an icon is useful, import one from `lucide-react` or `@tabler/icons-react`; otherwise use text labels or badges.
- Do not use decorative emoji anywhere in generated app text such as status labels, table cells, headings, empty states, or summaries.

Before calling `save_app`, self-check the generated `App.tsx`:

- It default-exports a React component and renders a dashboard body only.
- It is not a markdown report or prose summary.
- It includes KPI cards plus at least one chart and one table/list with meaningful visual hierarchy.
- It does not use emoji characters for icons or labels.
- It has responsive constraints (`w-full`, `min-w-0`, grid wrapping, or equivalent) and avoids horizontal page scrolling.
- It avoids duplicate host chrome such as an outer artifact card, `App` badge, or open-full control.

Export `refresh()` when the dashboard can be refreshed. It must rerun saved source queries or deterministic transforms and return data shaped like `CrmDashboardData`; it must not reinterpret the whole prompt or create a different app.

Call `save_app` directly in the parent Computer turn. Include:

- `name`: concise user-facing dashboard name.
- `files`: at least `App.tsx` with a default export and refresh support when available.
- `metadata.kind`: `computer_applet`.
- `metadata.threadId`: current thread id when available.
- `metadata.prompt`: user prompt.
- `metadata.recipe`: `crm-dashboard`.
- `metadata.recipeVersion`: `1`.
- `metadata.runbookSlug`: `crm-dashboard`.
- `metadata.dataShape`: `CrmDashboardData`.

Only report success after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`.
