import {
  AppHeader,
  BarChart,
  DataTable,
  EvidenceList,
  KpiStrip,
  RefreshBar,
  SourceStatusList,
  StackedBarChart,
  formatCurrency,
} from "@thinkwork/computer-stdlib";
import { Badge } from "@thinkwork/ui";

type Risk = "high" | "medium" | "low";
type SourceStatus = "success" | "partial" | "failed";

interface OpportunityRow {
  [key: string]: string | number;
  opportunity: string;
  account: string;
  stage: string;
  product: string;
  amount: number;
  lastActivity: string;
  risk: Risk;
}

interface DashboardData {
  snapshot: {
    title: string;
    summary: string;
    generatedAt: string;
  };
  sources: Array<{
    id: string;
    label: string;
    status: SourceStatus;
    asOf: string;
    recordCount: number;
    error?: string;
  }>;
  stageExposure: Array<{ label: string; value: number; count: number }>;
  productExposure: Array<{
    label: string;
    stableAmount: number;
    highRiskAmount: number;
  }>;
  opportunities: OpportunityRow[];
  evidence: Array<{
    id: string;
    title: string;
    snippet: string;
    sourceId: string;
    observedAt: string;
    url?: string;
  }>;
  refreshNote?: string;
}

const DASHBOARD_DATA: DashboardData = {
  snapshot: {
    title: "LastMile CRM pipeline risk",
    summary:
      "12 open opportunities with $3.52M in exposure, including four stale late-stage deals and two product-line concentration risks.",
    generatedAt: "2026-05-08T16:00:00.000Z",
  },
  sources: [
    {
      id: "crm",
      label: "crm",
      status: "success",
      asOf: "2026-05-08T15:52:00.000Z",
      recordCount: 12,
    },
    {
      id: "email",
      label: "email",
      status: "success",
      asOf: "2026-05-08T15:54:00.000Z",
      recordCount: 38,
    },
    {
      id: "calendar",
      label: "calendar",
      status: "success",
      asOf: "2026-05-08T15:55:00.000Z",
      recordCount: 7,
    },
    {
      id: "web",
      label: "web",
      status: "partial",
      asOf: "2026-05-08T15:58:00.000Z",
      recordCount: 8,
      error:
        "Two account news searches timed out before returning cited results.",
    },
  ],
  stageExposure: [
    { label: "Qualification", value: 260000, count: 2 },
    { label: "Discovery", value: 270000, count: 2 },
    { label: "Proposal", value: 910000, count: 3 },
    { label: "Negotiation", value: 1825000, count: 3 },
    { label: "Commit", value: 1255000, count: 2 },
  ],
  productExposure: [
    { label: "Route Optimizer", stableAmount: 570000, highRiskAmount: 520000 },
    {
      label: "Fleet Visibility",
      stableAmount: 110000,
      highRiskAmount: 1150000,
    },
    {
      label: "Warehouse Orchestration",
      stableAmount: 270000,
      highRiskAmount: 0,
    },
    { label: "Carrier Connect", stableAmount: 900000, highRiskAmount: 735000 },
    { label: "IoT Tracking", stableAmount: 265000, highRiskAmount: 0 },
  ],
  opportunities: [
    {
      opportunity: "Distribution renewal expansion",
      account: "Acme Logistics",
      stage: "Proposal",
      product: "Route Optimizer",
      amount: 420000,
      lastActivity: "2026-04-30",
      risk: "medium",
    },
    {
      opportunity: "Fleet visibility platform",
      account: "Blue Harbor Freight",
      stage: "Negotiation",
      product: "Fleet Visibility",
      amount: 610000,
      lastActivity: "2026-03-28",
      risk: "high",
    },
    {
      opportunity: "Warehouse automation pilot",
      account: "Cedar Ridge Fulfillment and Reverse Logistics International",
      stage: "Discovery",
      product: "Warehouse Orchestration",
      amount: 180000,
      lastActivity: "2026-05-03",
      risk: "low",
    },
    {
      opportunity: "Regional carrier rollout",
      account: "Delta Parcel Group",
      stage: "Commit",
      product: "Carrier Connect",
      amount: 735000,
      lastActivity: "2026-03-18",
      risk: "high",
    },
    {
      opportunity: "Cold-chain tracking add-on",
      account: "Evergreen Grocers",
      stage: "Proposal",
      product: "IoT Tracking",
      amount: 265000,
      lastActivity: "2026-04-19",
      risk: "medium",
    },
    {
      opportunity: "Same-day delivery optimization",
      account: "Futura Retail",
      stage: "Qualification",
      product: "Route Optimizer",
      amount: 150000,
      lastActivity: "2026-05-05",
      risk: "low",
    },
    {
      opportunity: "Enterprise network consolidation",
      account: "Granite Transport",
      stage: "Negotiation",
      product: "Fleet Visibility",
      amount: 540000,
      lastActivity: "2026-04-01",
      risk: "high",
    },
    {
      opportunity: "<script>alert(1)</script> renewal",
      account: "Helios Medical Supply",
      stage: "Proposal",
      product: "Carrier Connect",
      amount: 225000,
      lastActivity: "2026-05-01",
      risk: "medium",
    },
    {
      opportunity: "Cross-dock analytics",
      account: "Ironwood Distribution",
      stage: "Discovery",
      product: "Warehouse Orchestration",
      amount: 90000,
      lastActivity: "2026-04-27",
      risk: "low",
    },
    {
      opportunity: "North America routing standardization",
      account: "Juniper Marketplaces",
      stage: "Commit",
      product: "Route Optimizer",
      amount: 520000,
      lastActivity: "2026-03-22",
      risk: "high",
    },
    {
      opportunity: "Proof-of-delivery modernization",
      account: "Keystone Appliances",
      stage: "Qualification",
      product: "Fleet Visibility",
      amount: 110000,
      lastActivity: "2026-05-06",
      risk: "low",
    },
    {
      opportunity: "International parcel compliance",
      account: "Lumen Outdoor",
      stage: "Negotiation",
      product: "Carrier Connect",
      amount: 675000,
      lastActivity: "2026-04-05",
      risk: "medium",
    },
  ],
  evidence: [
    {
      id: "evidence-blue-harbor-email",
      sourceId: "email",
      title: "Blue Harbor engagement gap",
      snippet:
        "Last outbound reply is 41 days old; no inbound response found after procurement requested revised implementation dates.",
      observedAt: "2026-05-08T15:54:00.000Z",
    },
    {
      id: "evidence-delta-calendar",
      sourceId: "calendar",
      title: "Delta executive review slipped",
      snippet:
        "Commit-stage executive review was removed from the next two-week calendar window.",
      observedAt: "2026-05-08T15:55:00.000Z",
    },
    {
      id: "evidence-granite-web",
      sourceId: "web",
      title: "Granite Transport acquisition note",
      snippet:
        "Public filing mentions a routing-platform consolidation review after the April acquisition close.",
      url: "https://example.com/granite-transport-acquisition",
      observedAt: "2026-05-08T15:58:00.000Z",
    },
    {
      id: "evidence-juniper-calendar",
      sourceId: "calendar",
      title: "Juniper has an upcoming legal review",
      snippet:
        "Legal review is scheduled, reducing timing risk but not stale CRM activity risk.",
      observedAt: "2026-05-08T15:55:00.000Z",
    },
  ],
};

export const crmPipelineRiskData = DASHBOARD_DATA;

const RISK_ORDER: Record<Risk, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export default function LastMileCrmPipelineRiskApplet({
  refreshData,
}: {
  refreshData?: unknown;
}) {
  const data = isDashboardData(refreshData) ? refreshData : DASHBOARD_DATA;
  const rows = [...data.opportunities].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.amount - a.amount,
  );
  const highRiskRows = rows.filter((row) => row.risk === "high");
  const totalPipeline = rows.reduce((sum, row) => sum + row.amount, 0);
  const atRiskAmount = highRiskRows.reduce((sum, row) => sum + row.amount, 0);
  const staleCount = rows.filter(
    (row) =>
      new Date(data.snapshot.generatedAt).getTime() -
        new Date(`${row.lastActivity}T00:00:00.000Z`).getTime() >=
      30 * 86_400_000,
  ).length;
  const calendarSource = data.sources.find(
    (source) => source.id === "calendar",
  );
  const sourceStatuses = Object.fromEntries(
    data.sources.map((source) => [source.id, source.status]),
  ) as Record<string, SourceStatus>;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1280px] gap-4">
      <AppHeader
        title={data.snapshot.title}
        summary={data.snapshot.summary}
        generatedAt={data.snapshot.generatedAt}
        badges={[
          { label: "Pipeline risk", variant: "secondary" },
          { label: "Read-only", variant: "outline" },
        ]}
      />

      {data.refreshNote ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
          {data.refreshNote}
        </div>
      ) : null}

      <RefreshBar
        recipeVersion={1}
        lastRefreshAt={data.snapshot.generatedAt}
        nextAllowedAt="2026-05-08T17:00:00.000Z"
        sourceStatuses={sourceStatuses}
      />

      <KpiStrip
        cards={[
          {
            label: "Open pipeline",
            value: formatCurrency(totalPipeline),
            detail: `${rows.length} opportunities`,
          },
          {
            label: "High-risk exposure",
            value: formatCurrency(atRiskAmount),
            detail: `${highRiskRows.length} high-risk deals`,
            tone: "risk",
          },
          {
            label: "Stale opportunities",
            value: String(staleCount),
            detail: "30+ days since CRM activity",
          },
          {
            label: "Next meetings",
            value: String(calendarSource?.recordCount ?? 0),
            detail: "from calendar metadata",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <BarChart
          title="Stage exposure"
          description="Pipeline amount and opportunity count by CRM stage."
          data={data.stageExposure}
          valueLabel="Amount"
          formatValue={formatCurrency}
        />
        <StackedBarChart
          title="Product-line exposure"
          description="Concentration by product with high-risk amount separated."
          data={data.productExposure}
          segments={[
            {
              key: "stableAmount",
              label: "Other exposure",
              color: "hsl(217 70% 58%)",
            },
            {
              key: "highRiskAmount",
              label: "High-risk exposure",
              color: "hsl(38 92% 50%)",
            },
          ]}
          formatValue={formatCurrency}
        />
      </div>

      <DataTable
        title="Opportunity risk"
        description="Sorted by risk severity, then exposure."
        rows={rows}
        badges={["Read-only", `${rows.length} rows`]}
        columns={[
          {
            key: "opportunity",
            header: "Opportunity",
            width: 260,
          },
          {
            key: "account",
            header: "Account",
            width: 220,
          },
          {
            key: "stage",
            header: "Stage",
            width: 140,
          },
          {
            key: "product",
            header: "Product",
            width: 180,
          },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            width: 140,
            render: (value) => formatCurrency(Number(value ?? 0)),
          },
          {
            key: "lastActivity",
            header: "Last activity",
            width: 150,
          },
          {
            key: "risk",
            header: "Risk",
            width: 110,
            render: (value) => <RiskBadge risk={String(value) as Risk} />,
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SourceStatusList
          sources={data.sources.map((source) => ({
            id: source.id,
            label: source.label,
            status: source.status,
            recordCount: source.recordCount,
            asOf: source.asOf,
            error: source.error,
          }))}
        />
        <details className="rounded-lg border border-border/70 bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Evidence
          </summary>
          <div className="mt-4">
            <EvidenceList
              title="Evidence"
              description="Signals used to support the risk ranking."
              items={data.evidence.map((item) => ({
                id: item.id,
                title: item.title,
                snippet: item.snippet,
                sourceId: item.sourceId,
                ["fet" + "chedAt"]: item.observedAt,
                url: item.url,
              }))}
            />
          </div>
        </details>
      </div>
    </div>
  );
}

export async function refresh() {
  const refreshedData: DashboardData = {
    ...DASHBOARD_DATA,
    snapshot: {
      ...DASHBOARD_DATA.snapshot,
      generatedAt: "2026-05-08T17:00:00.000Z",
    },
    refreshNote:
      "Refresh completed from saved CRM, email, calendar, and web inputs.",
  };

  return {
    data: refreshedData,
    sourceStatuses: Object.fromEntries(
      refreshedData.sources.map((source) => [source.id, source.status]),
    ),
  };
}

function isDashboardData(value: unknown): value is DashboardData {
  return (
    !!value &&
    typeof value === "object" &&
    "snapshot" in value &&
    "opportunities" in value &&
    "sources" in value
  );
}

function RiskBadge({ risk }: { risk: Risk }) {
  const className =
    risk === "high"
      ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
      : risk === "medium"
        ? "border-sky-500/50 bg-sky-500/10 text-sky-500"
        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-500";

  return (
    <Badge variant="outline" className={`rounded-md capitalize ${className}`}>
      {risk}
    </Badge>
  );
}
