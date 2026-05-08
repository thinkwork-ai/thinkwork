import crmPipelineRiskManifest from "@/test/fixtures/crm-pipeline-risk-dashboard.json";
import { computerAppArtifactRoute } from "@/lib/computer-routes";

export type DashboardArtifactManifest = typeof crmPipelineRiskManifest;

export interface AppArtifactPreview {
  id: string;
  title: string;
  kind: "research_dashboard";
  dashboardKind: "pipeline_risk";
  summary: string;
  href: string;
  generatedAt: string;
  sourceStatuses: Array<{
    provider: string;
    status: string;
  }>;
  riskCount: number;
  atRiskAmount: number;
}

export const FIXTURE_APP_ARTIFACTS: AppArtifactPreview[] = [
  toPipelineRiskPreview(crmPipelineRiskManifest),
];

export const FIXTURE_APP_MANIFESTS: DashboardArtifactManifest[] = [
  crmPipelineRiskManifest,
];

export function getFixtureAppArtifactById(
  artifactId: string,
): AppArtifactPreview | null {
  return (
    FIXTURE_APP_ARTIFACTS.find((artifact) => artifact.id === artifactId) ?? null
  );
}

export function getFixtureDashboardManifestByArtifactId(
  artifactId: string,
): DashboardArtifactManifest | null {
  return (
    FIXTURE_APP_MANIFESTS.find(
      (manifest) => manifest.snapshot.artifactId === artifactId,
    ) ?? null
  );
}

export function isAppArtifactMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const raw = metadata as Record<string, unknown>;
  return raw.kind === "research_dashboard" || raw.uiSurface === "app";
}

type OpportunityPreviewRow = {
  amount?: number;
  risk?: string;
};

function toPipelineRiskPreview(
  manifest: typeof crmPipelineRiskManifest,
): AppArtifactPreview {
  const rows =
    (manifest.tables.find((table) => table.id === "opportunities")?.rows ??
      []) as OpportunityPreviewRow[];
  const riskCount = rows.filter((row) => row.risk === "high").length;
  const atRiskAmount = rows
    .filter((row) => row.risk === "high")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return {
    id: manifest.snapshot.artifactId,
    title: manifest.snapshot.title,
    kind: "research_dashboard",
    dashboardKind: "pipeline_risk",
    summary: manifest.snapshot.summary,
    href: computerAppArtifactRoute(manifest.snapshot.artifactId),
    generatedAt: manifest.snapshot.generatedAt,
    sourceStatuses: manifest.sources.map((source) => ({
      provider: source.provider,
      status: source.status,
    })),
    riskCount,
    atRiskAmount,
  } satisfies AppArtifactPreview;
}
