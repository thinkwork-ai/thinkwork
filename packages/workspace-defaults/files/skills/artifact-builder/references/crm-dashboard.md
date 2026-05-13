# CRM Dashboard Recipe

Use this reference when the user asks for a CRM, sales pipeline, opportunity, account-risk, stage-exposure, stale-activity, or LastMile dashboard app.

This file is retained as the Artifact Builder compatibility reference. The published `crm-dashboard` runbook owns orchestration and phase sequencing; this reference supplies the dashboard data shape, artifact layout, refresh contract, and `save_app` metadata for legacy prompts or active runbook produce phases.

The goal is a saved, reusable app. Do not stop at analysis prose. Normalize the available data first, generate the app source second, then call `save_app` directly.

The quality bar is an operational CRM dashboard, not a formatted report. The app should resemble a dense LastMile-style sales dashboard: compact header and source/status badges, KPI strip, visual pipeline/risk comparisons, sortable or scannable entity rows, and restrained color accents for value, risk, stale activity, and success.

Do not use emoji as icons, status markers, bullets, tab labels, headings, empty states, or data values. When an icon is useful, import it from `lucide-react`; otherwise use plain text or styled badges.

## Source Discovery

Use the best sources available in this order:

1. Thread context and any attached or already retrieved CRM rows.
2. Available CRM, connector, MCP, context, workspace, memory, or Hindsight tools.
3. Email, calendar, and web context when the prompt asks for stale activity, next meetings, or external account risk.
4. A small demo or fixture-shaped dataset only when live sources are missing. Make limitations visible only when they materially affect the displayed result.

Missing live data is not a blocker. The app should still run and should stay focused on the requested dashboard rather than rendering provenance panels.

## Canonical Data Shape

Normalize source results into `CrmDashboardData` before writing TSX. Keep this shape stable even when some arrays are empty.

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
      stageExposure: Array<{
        label: string;
        value: number;
        count: number;
      }>;
      staleActivity: Array<{
        label: string;
        value: number;
        count: number;
      }>;
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

## App Layout

Build one responsive app that fits the available horizontal space with `w-full min-w-0 max-w-[1280px]`. Do not create horizontal page scrolling. Prefer stacked or wrapped layouts on narrow widths.

The host already provides Artifact chrome, including the route title, `App` label, full-screen action, refresh action placement, and sandboxed iframe wrapper. Render the dashboard body only; do not add a duplicate app shell, route header, evidence panel, source coverage panel, or refresh recipe unless the user explicitly requests it.

Required sections:

- Body intro or context row only when it helps interpret the dashboard.
- KPIs: total pipeline, high-risk exposure, stale opportunity count, and next-meeting or source-health count when available.
- Stage exposure: a bar chart or stacked bar chart from `stageExposure`.
- Stale activity: a chart or compact table from `staleActivity`.
- Top risks: a ranked table or compact list from `topRisks`, sorted by risk and exposure.
- Opportunities: a sortable/scannable table from `opportunities`.

Use shadcn-compatible primitives from `@thinkwork/ui` for layout and controls: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `ScrollArea`, and `Separator` where applicable.

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`.

Theme requirements:

- If the user provides Theme CSS from shadcn Create, preserve it in `metadata.appletTheme = { source: "shadcn-create", css: "..." }` on `preview_app` and `save_app`.
- Use semantic shadcn token classes and chart variables: `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `border-border`, `text-muted-foreground`, `bg-muted`, and `var(--chart-1)` through `var(--chart-5)`.
- Do not paste a `<style>` tag into `App.tsx`, hard-code black chart marks on dark surfaces, or invent a separate palette that fights the uploaded theme.

Do not hand-roll cards, tabs, badges, buttons, or tables. Tabs must use `Tabs`/`TabsList`/`TabsTrigger`; tabular data must use `DataTable` or `Table`; status labels must use `Badge`; metric panels must use `Card` or `KpiStrip`.

Do not use emoji icons. Use `lucide-react` icons when an icon is needed.

Use the stdlib prop names directly:

- `KpiStrip` receives `cards={data.kpis}`.
- `DataTable` receives `columns={...}` and `rows={data.opportunities}`.
- `BarChart` receives `data={data.stageExposure}` or `data={data.staleActivity}`.

Before saving, reject the draft and revise it if any of these are true:

- The app reads like a markdown report or prose summary.
- Core metrics are shown as paragraphs instead of visual comparisons.
- It lacks a KPI strip, chart, or table.
- It uses emoji characters for icons or labels.
- It duplicates host chrome such as an outer artifact frame, `App` badge, open-full control, or refresh controls supplied by the host.

## Empty And Partial States

If no CRM opportunities are available, still save a runnable app. Show empty KPI values, an empty table, and a concise empty state.

If CRM rows exist but email, calendar, or web signals are missing, keep the CRM sections populated. Do not add source coverage or evidence panels.

Never hide uncertainty, but keep it proportional: use a short note near the affected metric only when it changes how the user should read the dashboard.

## Refresh Contract

Export `refresh()` when the dashboard can be refreshed. It must return deterministic data shaped like this:

    export async function refresh() {
      return {
        data: refreshedCrmDashboardData,
        sourceStatuses: { crm: "success" },
      };
    }

Refresh should rerun saved source queries or deterministic transforms. It must not reinterpret the whole prompt or create a different app.

The artifact host renders refresh actions in its top-bar actions menu. Do not render a refresh control, refresh timeline, recipe explainer, or `RefreshBar` inside the app unless the user explicitly asks for a custom in-artifact refresh experience.

## Save Contract

Call `save_app` directly after generating the files. Do not delegate saving to another agent or tool.

Use:

- `name`: a concise user-facing dashboard name.
- `files`: at least `App.tsx` with default export and `refresh()`.
- `metadata.kind`: `computer_applet`.
- `metadata.threadId`: current thread id when available.
- `metadata.prompt`: the user prompt.
- `metadata.recipe`: `crm-dashboard`.
- `metadata.recipeVersion`: `1`.
- `metadata.dataShape`: `CrmDashboardData`.
- `metadata.appletTheme`: user-provided shadcn Create theme CSS when available.

Only tell the user the artifact exists after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`.
