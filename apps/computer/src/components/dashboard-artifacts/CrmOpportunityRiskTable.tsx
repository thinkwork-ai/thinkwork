import { Badge } from "@thinkwork/ui";
import type { ReactNode } from "react";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import {
  formatCurrency,
  getOpportunityRows,
  type OpportunityRisk,
  type OpportunityRiskRow,
} from "@/components/dashboard-artifacts/dashboard-data";

interface CrmOpportunityRiskTableProps {
  manifest: DashboardArtifactManifest;
}

const RISK_ORDER: Record<OpportunityRisk, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function CrmOpportunityRiskTable({
  manifest,
}: CrmOpportunityRiskTableProps) {
  const rows = [...getOpportunityRows(manifest)].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.amount - a.amount,
  );

  return (
    <section className="rounded-lg border border-border/70 bg-background">
      <div className="flex flex-col gap-2 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Opportunity risk</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sorted by risk severity, then exposure.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-md">
            Read-only
          </Badge>
          <Badge variant="secondary" className="rounded-md">
            {rows.length} rows
          </Badge>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <TableHead>Opportunity</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead>Risk</TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RiskRow key={`${row.account}-${row.opportunity}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskRow({ row }: { row: OpportunityRiskRow }) {
  return (
    <tr className="border-b border-border/50 last:border-b-0">
      <TableCell>
        <span className="block max-w-[18rem] truncate font-medium">
          {row.opportunity}
        </span>
      </TableCell>
      <TableCell>
        <span className="block max-w-[16rem] truncate">{row.account}</span>
      </TableCell>
      <TableCell>{row.stage}</TableCell>
      <TableCell>
        <span className="block max-w-[12rem] truncate">{row.product}</span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatCurrency(row.amount)}
      </TableCell>
      <TableCell>{row.lastActivity}</TableCell>
      <TableCell>
        <RiskBadge risk={row.risk} />
      </TableCell>
    </tr>
  );
}

function RiskBadge({ risk }: { risk: OpportunityRisk }) {
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

function TableHead({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>;
}

function TableCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-3 align-middle ${className}`}>{children}</td>;
}
