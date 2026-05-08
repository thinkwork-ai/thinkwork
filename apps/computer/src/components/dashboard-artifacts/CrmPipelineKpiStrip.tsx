import { AlertTriangle, CalendarDays, DollarSign, Layers3 } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import {
  formatCurrency,
  getAtRiskAmount,
  getOpportunityRows,
  getStaleOpportunityCount,
  getTotalPipeline,
} from "@/components/dashboard-artifacts/dashboard-data";

interface CrmPipelineKpiStripProps {
  manifest: DashboardArtifactManifest;
}

export function CrmPipelineKpiStrip({ manifest }: CrmPipelineKpiStripProps) {
  const rows = getOpportunityRows(manifest);
  const calendarSource = manifest.sources.find(
    (source) => source.provider === "calendar",
  );
  const staleCount = getStaleOpportunityCount(rows, manifest.snapshot.generatedAt);

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={<DollarSign className="size-4" />}
        label="Open pipeline"
        value={formatCurrency(getTotalPipeline(rows))}
        detail={`${rows.length} opportunities`}
      />
      <KpiCard
        icon={<AlertTriangle className="size-4" />}
        label="High-risk exposure"
        value={formatCurrency(getAtRiskAmount(rows))}
        detail={`${rows.filter((row) => row.risk === "high").length} high-risk deals`}
        tone="risk"
      />
      <KpiCard
        icon={<Layers3 className="size-4" />}
        label="Stale opportunities"
        value={String(staleCount)}
        detail="30+ days since CRM activity"
      />
      <KpiCard
        icon={<CalendarDays className="size-4" />}
        label="Next meetings"
        value={String(calendarSource?.recordCount ?? 0)}
        detail="from calendar metadata"
      />
    </section>
  );
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "risk";
}) {
  return (
    <article className="rounded-lg border border-border/70 bg-background p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={
            tone === "risk"
              ? "flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-500"
              : "flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary"
          }
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </article>
  );
}
