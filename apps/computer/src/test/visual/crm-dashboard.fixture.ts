import { crmPipelineRiskData } from "@/test/fixtures/crm-pipeline-risk-applet/source";

export const crmDashboardVisualFixtures = {
  base: cloneData(),
  partialCoverage: cloneData((data) => {
    data.refreshNote = "Some supporting context was unavailable.";
  }),
  failedCrm: cloneData((data) => {
    data.refreshNote = "CRM refresh failed; prior dashboard values remain visible.";
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
