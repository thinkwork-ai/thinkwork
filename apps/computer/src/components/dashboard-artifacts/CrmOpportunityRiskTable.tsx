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
      <div className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <TableHead className="w-[36%]">Opportunity</TableHead>
              <TableHead className="hidden w-[22%] sm:table-cell">
                Account
              </TableHead>
              <TableHead className="hidden w-[14%] md:table-cell">
                Stage
              </TableHead>
              <TableHead className="hidden w-[14%] lg:table-cell">
                Product
              </TableHead>
              <TableHead className="w-[24%] text-right sm:w-[16%]">
                Amount
              </TableHead>
              <TableHead className="hidden w-[14%] xl:table-cell">
                Last activity
              </TableHead>
              <TableHead className="w-[20%] sm:w-[12%]">Risk</TableHead>
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
        <span className="block min-w-0 truncate font-medium">
          {row.opportunity}
        </span>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="block min-w-0 truncate">{row.account}</span>
      </TableCell>
      <TableCell className="hidden truncate md:table-cell">
        {row.stage}
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <span className="block min-w-0 truncate">{row.product}</span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatCurrency(row.amount)}
      </TableCell>
      <TableCell className="hidden truncate xl:table-cell">
        {row.lastActivity}
      </TableCell>
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
  return (
    <th className={`px-3 py-2 text-left font-medium ${className}`}>
      {children}
    </th>
  );
}

function TableCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`min-w-0 overflow-hidden px-3 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}
