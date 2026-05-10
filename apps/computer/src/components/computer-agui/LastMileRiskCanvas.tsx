import { AlertTriangle, CheckCircle2, Clock3, DollarSign } from "lucide-react";
import {
  DataTable,
  KpiStrip,
  SourceStatusList,
  formatCurrency,
  formatNumber,
  type SourceStatus,
} from "@thinkwork/computer-stdlib";
import { Badge } from "@thinkwork/ui";

export interface LastMileRiskKpi {
  label: string;
  value: string | number;
  detail?: string | null;
  tone?: "default" | "risk" | "success" | "neutral";
}

export interface LastMileRiskRow {
  account: string;
  opportunity?: string | null;
  stage?: string | null;
  amount?: number | null;
  daysStale?: number | null;
  riskLevel?: "low" | "medium" | "high" | null;
  nextStep?: string | null;
}

export interface LastMileRiskSource {
  name: string;
  status: "connected" | "missing" | "stale" | "error";
  recordCount?: number | null;
  asOf?: string | null;
  detail?: string | null;
}

export interface LastMileRiskCanvasProps {
  title?: string | null;
  summary?: string | null;
  kpis?: LastMileRiskKpi[];
  risks?: LastMileRiskRow[];
  sources?: LastMileRiskSource[];
}

export function LastMileRiskCanvas({
  title = "LastMile pipeline risk",
  summary,
  kpis = [],
  risks = [],
  sources = [],
}: LastMileRiskCanvasProps) {
  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {summary ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {summary}
              </p>
            ) : null}
          </div>
          <Badge variant="outline" className="rounded-md">
            LastMile
          </Badge>
        </div>
      </section>

      <KpiStrip cards={toKpiCards(kpis)} />

      <DataTable
        title="Opportunity risk"
        description="Open deals ranked by stale activity, stage exposure, and next review action."
        rows={risks.map(toRiskTableRow)}
        columns={[
          {
            key: "account",
            header: "Account",
            sortable: false,
            render: (_value, row) => (
              <span className="grid gap-0.5">
                <span className="truncate font-medium">
                  {String(row.account)}
                </span>
                {row.opportunity ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {String(row.opportunity)}
                  </span>
                ) : null}
              </span>
            ),
          },
          { key: "stage", header: "Stage", sortable: false },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            sortable: false,
          },
          {
            key: "daysStale",
            header: "Stale",
            align: "right",
            sortable: false,
          },
          {
            key: "riskLevel",
            header: "Risk",
            sortable: false,
            render: (_value, row) => (
              <RiskBadge riskLevel={String(row.riskLevel)} />
            ),
          },
          {
            key: "nextStep",
            header: "Next step",
            sortable: false,
          },
        ]}
        emptyState="No pipeline risks reported."
      />

      <SourceStatusList
        title="Source status"
        description="CRM and activity coverage for the generated pipeline view."
        sources={sources.map((source, index) => ({
          id: `${source.name}-${index}`,
          label: source.name,
          status: toSourceStatus(source.status),
          recordCount: source.recordCount ?? undefined,
          asOf: source.asOf ?? undefined,
          error: source.detail ?? undefined,
        }))}
      />
    </div>
  );
}

function toKpiCards(kpis: LastMileRiskKpi[]) {
  return kpis.map((kpi) => ({
    label: kpi.label,
    value: typeof kpi.value === "number" ? formatNumber(kpi.value) : kpi.value,
    detail: kpi.detail ?? undefined,
    tone: kpi.tone ?? "default",
    icon: kpiIcon(kpi.tone),
  }));
}

function kpiIcon(tone: LastMileRiskKpi["tone"]) {
  if (tone === "risk") return <AlertTriangle className="size-4" />;
  if (tone === "success") return <CheckCircle2 className="size-4" />;
  if (tone === "neutral") return <Clock3 className="size-4" />;
  return <DollarSign className="size-4" />;
}

function toRiskTableRow(row: LastMileRiskRow): Record<string, unknown> {
  return {
    account: row.account,
    opportunity: row.opportunity ?? "",
    stage: row.stage ?? "Unknown",
    amount:
      typeof row.amount === "number" ? formatCurrency(row.amount) : "Unknown",
    daysStale:
      typeof row.daysStale === "number" ? `${row.daysStale}d` : "Unknown",
    riskLevel: row.riskLevel ?? "medium",
    nextStep: row.nextStep ?? "Review account history",
  };
}

function RiskBadge({ riskLevel }: { riskLevel: string }) {
  const normalized = riskLevel.toLowerCase();
  const className =
    normalized === "high"
      ? "border-red-200 bg-red-50 text-red-700"
      : normalized === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <Badge variant="outline" className={`rounded-md ${className}`}>
      {normalized}
    </Badge>
  );
}

function toSourceStatus(status: LastMileRiskSource["status"]): SourceStatus {
  if (status === "connected") return "success";
  if (status === "error") return "failed";
  return "partial";
}
