# Produce dashboard artifact

Generate and save one interactive CRM dashboard artifact from the fetched dashboard dataset. Do not perform another discovery pass, write a separate analysis report, or run a separate validation phase. The durable output is the saved app.

Normalize the previous phase output into `CrmDashboardData` before writing TSX:

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
  sourceStatuses?: Array<{
    id: string;
    label: string;
    status: SourceStatus;
    recordCount?: number;
    asOf?: string;
  }>;
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
    owner?: string;
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

Build the app body only. The Computer host supplies artifact chrome, route title, app label, open-full action, refresh action placement, and iframe wrapper.

Use shadcn-compatible primitives from `@thinkwork/ui` for dashboard layout and controls: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `ScrollArea`, `Separator`, and `ChartContainer` where applicable.

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`.

Theme requirements:

- Prefer host-injected shadcn Create theme tokens when available. Users configure Theme CSS through tenant app style settings; do not preserve that CSS in artifact metadata or generated TSX.
- Write component classes against shadcn semantic tokens: `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `border-border`, `text-muted-foreground`, `bg-muted`, `text-primary`, `text-destructive`, and `bg-accent`.
- Use chart colors from CSS variables (`var(--chart-1)` through `var(--chart-5)`) or `ChartContainer` config. Never set bars, lines, or tooltip text to black on dark surfaces.
- Do not invent a one-off palette in TSX. Avoid raw hex colors unless the value comes directly from validated theme tokens.

Hard UI requirements:

- Import `@thinkwork/ui`.
- Include KPI cards or `KpiStrip`, at least one visual comparison, and an opportunity table or ranked list.
- Use `Tabs` for multiple dashboard views when useful.
- Use `Badge` for status/risk labels.
- Use `DataTable` or `Table` for tabular data.
- Use a compact, dense dashboard layout: KPI strip in a 2-4 column grid, charts side-by-side on desktop, and a single ranked table/list for the action surface.
- Do not hand-roll cards, tabs, badges, buttons, tables, or status pills from raw HTML plus custom classes.
- Do not use raw `<table>` or raw `<button>`.
- Do not use emoji anywhere.
- Import icons from `lucide-react` only if useful; otherwise use text labels and badges.
- Avoid duplicate host chrome and avoid horizontal page scrolling.
- Do not create a vertical stack of full-width KPI cards. That layout is a failed draft.
- Do not render Recharts primitives directly on a black canvas without shadcn chart tokens; the tooltip, axis labels, bars, and grid must remain readable in dark mode.

Validation should be bounded to compile/save correctness. Inspect the generated TSX once before `save_app`. If it obviously violates the hard UI requirements, revise once. Do not loop on subjective polish.

Call `save_app` directly in the parent Computer turn. Include:

- `name`: concise user-facing dashboard name.
- `files`: at least `App.tsx` with a default export and refresh support when available.
- `metadata.kind`: `computer_applet`.
- `metadata.threadId`: current thread id when available.
- `metadata.prompt`: user prompt.
- `metadata.recipe`: `crm-dashboard`.
- `metadata.recipeVersion`: `2`.
- `metadata.runbookSlug`: `crm-dashboard`.
- `metadata.dataShape`: `CrmDashboardData`.
- Do not include theme CSS or app-owned theme objects in metadata.

Only report success after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`. If `save_app` fails once, return the concrete error and stop instead of regenerating repeatedly.
