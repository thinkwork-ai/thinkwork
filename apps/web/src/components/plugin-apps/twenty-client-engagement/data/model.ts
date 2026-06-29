export const TWENTY_CLIENT_ENGAGEMENT_APP_KEY = "twenty-client-engagement";
export const TWENTY_PROVIDER = "twenty";

export type PrototypePageId =
  | "dashboard"
  | "value-alignment"
  | "presession-brief"
  | "tool-guide"
  | "discovery-tool"
  | "opportunity-pipeline";

export type PrototypePageKind =
  | "dashboard"
  | "client-brief"
  | "internal-guide"
  | "engagement-tool"
  | "pipeline";

export interface PrototypePage {
  id: PrototypePageId;
  title: string;
  prototypeFile: string;
  routeSegment: string;
  kind: PrototypePageKind;
  stepLabel: string | null;
}

export type OpportunityStage =
  | "IDENTIFIED"
  | "VALUE_ALIGNMENT"
  | "DISCOVERY_SCOPE"
  | "SOW_DELIVERED"
  | "ACTIVE_ENGAGEMENT"
  | "CLOSED_LOST"
  | "DEFERRED";

export interface StageDefinition {
  value: OpportunityStage;
  label: string;
  activePipelineStage: boolean;
}

export interface StageGuidance {
  stage: OpportunityStage;
  next: string;
  tool: string;
}

export type LayerType = "CORE_PROBLEM" | "OPTIMIZATION" | "STRATEGIC_CONTROL";

export type LayerStatus =
  | "IDENTIFIED"
  | "IN_DISCOVERY"
  | "QUALIFYING"
  | "READY_FOR_SOW"
  | "APPROVED"
  | "DEFERRED";

export interface LayerDefinition {
  type: LayerType;
  label: string;
  description: string;
}

export interface LayerStatusDefinition {
  value: LayerStatus;
  label: string;
}

export interface ToolStep {
  step: string;
  name: string;
  pageId: PrototypePageId | null;
  prototypeUrl: string | null;
  activeStages: OpportunityStage[];
  doneStages: OpportunityStage[];
  disabledReason: string | null;
}

export interface OpportunityWorkspaceTab {
  index: number;
  label: string;
  minStage: OpportunityStage | null;
  lockedLabel: string | null;
}

export type OverlayRecordScope = "company" | "opportunity" | "app";

export interface PrototypeOverlayBucket {
  legacyKeyPattern: string;
  scope: OverlayRecordScope;
  providerRecordType: string;
  providerRecordIdSource: string;
  sectionKeys: string[];
  sourcePages: PrototypePageId[];
}

export interface PrototypeOpportunitySeed {
  id: string;
  name: string;
  companyId: string;
  overlaySections: string[];
}

export interface PrototypePipelineSeed {
  storageKey: string;
  useCaseAccountCount: number;
  strategicOpportunityCount: number;
  layerTitles: string[];
}
