import { crmPipelineRiskData } from "@/test/fixtures/crm-pipeline-risk-applet/source";

export const crmDashboardVisualFixtures = {
  base: cloneData(),
  partialCoverage: cloneData((data) => {
    data.sources = data.sources.map((source) =>
      source.id === "email" || source.id === "calendar"
        ? {
            ...source,
            status: "partial",
            error: `${source.id} returned partial metadata during visual verification.`,
          }
        : source,
    );
  }),
  failedCrm: cloneData((data) => {
    data.sources = data.sources.map((source) =>
      source.id === "crm"
        ? {
            ...source,
            status: "failed",
            error:
              "CRM refresh failed; the prior dashboard snapshot remains visible.",
          }
        : source,
    );
  }),
  denseProducts: cloneData((data) => {
    data.productExposure.push(
      {
        label: "Customs Intelligence",
        stableAmount: 235000,
        highRiskAmount: 120000,
      },
      { label: "Proof Network", stableAmount: 245000, highRiskAmount: 0 },
      {
        label: "Dock Scheduler",
        stableAmount: 220000,
        highRiskAmount: 90000,
      },
    );
  }),
} satisfies Record<string, typeof crmPipelineRiskData>;

function cloneData(
  mutate?: (data: typeof crmPipelineRiskData) => void,
): typeof crmPipelineRiskData {
  const data = structuredClone(crmPipelineRiskData);
  mutate?.(data);
  return data;
}
