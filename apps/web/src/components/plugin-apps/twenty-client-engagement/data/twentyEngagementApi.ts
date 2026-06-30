import { apiFetch } from "@/lib/api-fetch";

const BASE_PATH = "/api/plugin-apps/twenty/client-engagement";

export type EngagementCompany = {
  id: string;
  name: string;
  domainName: string | null;
  crmUrl: string | null;
};

export type EngagementOpportunity = {
  id: string;
  name: string;
  stage: string;
  stageLabel: string;
  amountMicros: number | null;
  closeDate: string | null;
  companyId: string | null;
  companyName: string | null;
  crmUrl: string | null;
};

export type EngagementLayer = {
  id: string;
  name: string | null;
  layerType: string;
  layerTypeLabel: string;
  instanceName: string | null;
  layerStatus: string;
  layerStatusLabel: string;
  whatWeKnow: string | null;
  openQuestions: string | null;
  businessValue: string | null;
  nextSteps: string | null;
  opportunityId: string;
};

export type EngagementStakeholder = {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  department: string | null;
  role: string | null;
  email: string | null;
  crmUrl: string | null;
};

export type EngagementOpportunityWithLayers = {
  opportunity: EngagementOpportunity;
  layers: EngagementLayer[];
};

export type EngagementAccount = {
  company: EngagementCompany;
  opportunities: EngagementOpportunityWithLayers[];
  stakeholders: EngagementStakeholder[];
};

export type TwentyEngagementDashboardResponse = {
  accounts: EngagementAccount[];
};

export type SaveStakeholderInput = {
  stakeholderId?: string | null;
  companyId: string;
  name: string;
  title?: string | null;
  department?: string | null;
  role?: string | null;
  email?: string | null;
};

export function fetchTwentyEngagementDashboard() {
  return apiFetch<TwentyEngagementDashboardResponse>(BASE_PATH);
}

export function saveTwentyStakeholder(input: SaveStakeholderInput) {
  const path = input.stakeholderId
    ? `${BASE_PATH}/stakeholders/${encodeURIComponent(input.stakeholderId)}`
    : `${BASE_PATH}/stakeholders`;
  return apiFetch<EngagementStakeholder>(path, {
    method: input.stakeholderId ? "PATCH" : "POST",
    body: JSON.stringify(input),
  });
}

export function updateTwentyOpportunityStage(
  opportunityId: string,
  stage: string,
) {
  return apiFetch<EngagementOpportunity>(
    `${BASE_PATH}/opportunities/${encodeURIComponent(opportunityId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    },
  );
}

export function updateTwentyLayerStatus(layerId: string, layerStatus: string) {
  return apiFetch<EngagementLayer>(
    `${BASE_PATH}/layers/${encodeURIComponent(layerId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ layerStatus }),
    },
  );
}
