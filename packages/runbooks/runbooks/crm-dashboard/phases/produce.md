# Produce dashboard artifact

Build an interactive dashboard artifact with a clear CRM information architecture: summary metrics, pipeline/risk breakdowns, entity-level tables or lists, and focused drill-in sections. Favor scan-friendly operational density over a marketing-style layout.

Use the Artifact Builder compatibility shim only as the implementation mechanism. The runbook owns the phase order and task queue; this phase owns the saved dashboard artifact.

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

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`. At minimum, include KPI cards, stage exposure, stale activity, top risks, and an opportunity table or list. Keep missing-source notes proportional and close to affected metrics.

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
