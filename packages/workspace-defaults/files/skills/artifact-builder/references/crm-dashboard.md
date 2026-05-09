# CRM Dashboard Recipe

Use this reference when the user asks for a CRM, sales pipeline, opportunity, account-risk, stage-exposure, stale-activity, or LastMile dashboard applet.

The goal is a saved, reusable applet. Do not stop at analysis prose. Normalize the available data first, generate the applet source second, then call `save_app` directly.

## Source Discovery

Use the best sources available in this order:

1. Thread context and any attached or already retrieved CRM rows.
2. Available CRM, connector, MCP, context, workspace, memory, or Hindsight tools.
3. Email, calendar, and web context when the prompt asks for stale activity, next meetings, external account risk, or evidence.
4. A small demo or fixture-shaped dataset only when live sources are missing. Mark that source as partial or failed inside the applet.

Missing live data is not a blocker. The applet should still run and should show source coverage honestly.

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
      sourceStatuses: Array<{
        id: "crm" | "email" | "calendar" | "web" | string;
        label: string;
        status: SourceStatus;
        asOf?: string;
        recordCount: number;
        error?: string;
      }>;
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
      evidence: Array<{
        id: string;
        title: string;
        snippet: string;
        sourceId: string;
        observedAt?: string;
        url?: string;
      }>;
      refreshNote?: string;
    }

## Applet Layout

Build one responsive applet that fits the available horizontal space with `w-full min-w-0 max-w-[1280px]`. Do not create horizontal page scrolling. Prefer stacked or wrapped layouts on narrow widths.

Required sections:

- Header: title, summary, generated time, and source badges.
- KPIs: total pipeline, high-risk exposure, stale opportunity count, and next-meeting or source-health count when available.
- Stage exposure: a bar chart from `stageExposure`.
- Stale activity: a chart or compact table from `staleActivity`.
- Top risks: a ranked table or list from `topRisks`, sorted by risk and exposure.
- Source coverage: `SourceStatusList` using `sourceStatuses`.
- Evidence: `EvidenceList` with CRM/email/calendar/web signals.

Use `@thinkwork/computer-stdlib` primitives where they fit: `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, `SourceStatusList`, `EvidenceList`, and formatters such as `formatCurrency`.

Use the stdlib prop names directly:

- `KpiStrip` receives `cards={data.kpis}`.
- `SourceStatusList` receives `sources={data.sourceStatuses}`.
- `EvidenceList` receives `items={data.evidence}`.
- `DataTable` receives `columns={...}` and `rows={data.opportunities}`.
- `BarChart` receives `data={data.stageExposure}` or `data={data.staleActivity}`.

## Empty And Partial States

If no CRM opportunities are available, still save a runnable applet. Show empty KPI values, an empty table, and a source status explaining which source is missing.

If CRM rows exist but email, calendar, or web signals are missing, keep the CRM sections populated and mark the missing supporting source as `partial` or `failed`.

Never hide uncertainty. Put the limitation in `sourceStatuses` and, when useful, in `refreshNote`.

## Refresh Contract

Export `refresh()` when the dashboard can be refreshed. It must return deterministic data shaped like this:

    export async function refresh() {
      return {
        data: refreshedCrmDashboardData,
        sourceStatuses: Object.fromEntries(
          refreshedCrmDashboardData.sourceStatuses.map((source) => [
            source.id,
            source.status,
          ]),
        ),
      };
    }

Refresh should rerun saved source queries or deterministic transforms. It must not reinterpret the whole prompt or create a different applet.

The artifact host renders refresh actions in its top-bar actions menu. Do not render a refresh control, refresh timeline, or `RefreshBar` inside the applet unless the user explicitly asks for a custom in-artifact refresh experience.

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
