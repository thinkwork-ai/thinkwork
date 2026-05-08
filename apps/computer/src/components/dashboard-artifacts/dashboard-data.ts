import type { DashboardArtifactManifest } from "@/lib/app-artifacts";

export type OpportunityRisk = "high" | "medium" | "low";

export interface OpportunityRiskRow {
  opportunity: string;
  account: string;
  stage: string;
  product: string;
  amount: number;
  lastActivity: string;
  risk: OpportunityRisk;
}

export interface StageExposureDatum {
  stage: string;
  amount: number;
  count: number;
}

export interface ProductExposureDatum {
  product: string;
  amount: number;
  highRiskAmount: number;
}

export function getOpportunityRows(
  manifest: DashboardArtifactManifest,
): OpportunityRiskRow[] {
  const rows =
    manifest.tables.find((table) => table.id === "opportunities")?.rows ?? [];
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    opportunity: String(row.opportunity ?? ""),
    account: String(row.account ?? ""),
    stage: String(row.stage ?? ""),
    product: String(row.product ?? ""),
    amount: Number(row.amount ?? 0),
    lastActivity: String(row.lastActivity ?? ""),
    risk: normalizeRisk(String(row.risk ?? "low")),
  }));
}

export function getStageExposure(
  manifest: DashboardArtifactManifest,
): StageExposureDatum[] {
  const chart = manifest.charts.find((item) => item.id === "stage-exposure");
  return ((chart?.data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    stage: String(item.stage ?? ""),
    amount: Number(item.amount ?? 0),
    count: Number(item.count ?? 0),
  }));
}

export function getProductExposure(
  manifest: DashboardArtifactManifest,
): ProductExposureDatum[] {
  const chart = manifest.charts.find((item) => item.id === "product-exposure");
  return ((chart?.data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    product: String(item.product ?? ""),
    amount: Number(item.amount ?? 0),
    highRiskAmount: Number(item.highRiskAmount ?? 0),
  }));
}

export function getTotalPipeline(rows: OpportunityRiskRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function getAtRiskAmount(rows: OpportunityRiskRow[]): number {
  return rows
    .filter((row) => row.risk === "high")
    .reduce((sum, row) => sum + row.amount, 0);
}

export function getStaleOpportunityCount(
  rows: OpportunityRiskRow[],
  generatedAt: string,
): number {
  const generatedDate = new Date(generatedAt);
  return rows.filter((row) => {
    const lastActivity = new Date(`${row.lastActivity}T00:00:00.000Z`);
    const ageInDays =
      (generatedDate.getTime() - lastActivity.getTime()) / 86_400_000;
    return ageInDays >= 30;
  }).length;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeRisk(value: string): OpportunityRisk {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}
