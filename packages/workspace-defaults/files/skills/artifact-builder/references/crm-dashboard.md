# CRM Dashboard Recipe

Use this reference when the user asks for a CRM, sales pipeline, opportunity, account-risk, stage-exposure, stale-activity, or LastMile dashboard app.

The goal is a saved, reusable app. Do not stop at analysis prose. Normalize the available data first, generate the app source second, then call `save_app` directly.

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

Required sections:

- Header: title, summary, generated time, and source badges.
- KPIs: total pipeline, high-risk exposure, stale opportunity count, and next-meeting or source-health count when available.
- Stage exposure: a bar chart from `stageExposure`.
- Stale activity: a chart or compact table from `staleActivity`.
- Top risks: a ranked table or list from `topRisks`, sorted by risk and exposure.

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, and formatters such as `formatCurrency`.

Use the stdlib prop names directly:

- `KpiStrip` receives `cards={data.kpis}`.
- `DataTable` receives `columns={...}` and `rows={data.opportunities}`.
- `BarChart` receives `data={data.stageExposure}` or `data={data.staleActivity}`.

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

Only tell the user the artifact exists after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`.
