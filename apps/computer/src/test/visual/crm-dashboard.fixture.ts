import baseManifest from "@/test/fixtures/crm-pipeline-risk-dashboard.json";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";

export const crmDashboardVisualFixtures = {
  base: cloneManifest(),
  partialCoverage: cloneManifest((manifest) => {
    manifest.sources = manifest.sources.map((source) =>
      source.provider === "email" || source.provider === "calendar"
        ? {
            ...source,
            status: "partial",
            safeDisplayError: `${source.provider} returned partial metadata during visual verification.`,
          }
        : source,
    );
  }),
  failedCrm: cloneManifest((manifest) => {
    manifest.sources = manifest.sources.map((source) =>
      source.provider === "crm"
        ? {
            ...source,
            status: "failed",
            safeDisplayError:
              "CRM refresh failed; the prior dashboard snapshot remains visible.",
          }
        : source,
    );
  }),
  denseProducts: cloneManifest((manifest) => {
    const productChart = manifest.charts.find(
      (chart) => chart.id === "product-exposure",
    );
    if (productChart) {
      (
        productChart.data as Array<{
          product: string;
          amount: number;
          highRiskAmount: number;
        }>
      ).push(
        {
          product: "Customs Intelligence",
          amount: 355000,
          highRiskAmount: 120000,
        },
        { product: "Proof Network", amount: 245000, highRiskAmount: 0 },
        { product: "Dock Scheduler", amount: 310000, highRiskAmount: 90000 },
      );
    }
  }),
} satisfies Record<string, DashboardArtifactManifest>;

function cloneManifest(
  mutate?: (manifest: DashboardArtifactManifest) => void,
): DashboardArtifactManifest {
  const manifest = structuredClone(baseManifest) as DashboardArtifactManifest;
  mutate?.(manifest);
  return manifest;
}
