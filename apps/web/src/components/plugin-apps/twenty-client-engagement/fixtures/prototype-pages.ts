import type {
  LayerDefinition,
  LayerStatusDefinition,
  OpportunityStage,
  OpportunityWorkspaceTab,
  PrototypePage,
  StageDefinition,
  StageGuidance,
  ToolStep,
} from "../data/model";

export const PROTOTYPE_PAGES: PrototypePage[] = [
  {
    id: "dashboard",
    title: "ThinkWork Client Intelligence",
    prototypeFile: "client-dashboard.html",
    routeSegment: "dashboard",
    kind: "dashboard",
    stepLabel: null,
  },
  {
    id: "value-alignment",
    title: "ThinkWork AI - Value Discovery & Alignment",
    prototypeFile: "discovery-value-alignment.html",
    routeSegment: "value-alignment",
    kind: "client-brief",
    stepLabel: "Engagement Step 1 of 4",
  },
  {
    id: "presession-brief",
    title: "ThinkWork AI - Discovery Session Brief",
    prototypeFile: "discovery-presession-brief.html",
    routeSegment: "presession-brief",
    kind: "client-brief",
    stepLabel: "Engagement Step 2 of 4",
  },
  {
    id: "tool-guide",
    title: "ThinkWork AI - Discovery Tool Guide",
    prototypeFile: "discovery-tool-guide.html",
    routeSegment: "tool-guide",
    kind: "internal-guide",
    stepLabel: null,
  },
  {
    id: "discovery-tool",
    title: "ThinkWork AI - Discovery Tool",
    prototypeFile: "discovery-tool.html",
    routeSegment: "discovery-tool",
    kind: "engagement-tool",
    stepLabel: "Engagement Step 4 of 4",
  },
  {
    id: "opportunity-pipeline",
    title: "ThinkWork AI - Opportunity Pipeline",
    prototypeFile: "opportunity-pipeline.html",
    routeSegment: "opportunity-pipeline",
    kind: "pipeline",
    stepLabel: null,
  },
];

export const STAGES: StageDefinition[] = [
  { value: "IDENTIFIED", label: "Identified", activePipelineStage: true },
  {
    value: "VALUE_ALIGNMENT",
    label: "Value Alignment",
    activePipelineStage: true,
  },
  {
    value: "DISCOVERY_SCOPE",
    label: "Discovery & Scope",
    activePipelineStage: true,
  },
  { value: "SOW_DELIVERED", label: "SOW Delivered", activePipelineStage: true },
  {
    value: "ACTIVE_ENGAGEMENT",
    label: "Active Engagement",
    activePipelineStage: true,
  },
  { value: "CLOSED_LOST", label: "Closed Lost", activePipelineStage: false },
  { value: "DEFERRED", label: "Deferred", activePipelineStage: false },
];

export const STAGE_GUIDANCE: StageGuidance[] = [
  {
    stage: "IDENTIFIED",
    next: "Schedule a Value Alignment session with the executive champion.",
    tool: "Step 1 - Value Alignment Brief",
  },
  {
    stage: "VALUE_ALIGNMENT",
    next: "Complete discovery session and begin mapping opportunity layers.",
    tool: "Step 2 - Discovery Kickoff Brief",
  },
  {
    stage: "DISCOVERY_SCOPE",
    next: "Build all 3 layers until at least one reaches Ready for SOW.",
    tool: "Opportunity Pipeline",
  },
  {
    stage: "SOW_DELIVERED",
    next: "Get SOW signed. Begin engagement setup and KPI baseline.",
    tool: "SOW under review",
  },
  {
    stage: "ACTIVE_ENGAGEMENT",
    next: "Deliver against committed KPIs. Track outcomes weekly.",
    tool: "Step 4 - KPI & Impact Tracker",
  },
];

export const TOOL_STEPS: ToolStep[] = [
  {
    step: "Step 1",
    name: "Value Alignment",
    pageId: "value-alignment",
    prototypeUrl: "/discovery-value-alignment.html",
    activeStages: ["IDENTIFIED", "VALUE_ALIGNMENT"],
    doneStages: ["DISCOVERY_SCOPE", "SOW_DELIVERED", "ACTIVE_ENGAGEMENT"],
    disabledReason: null,
  },
  {
    step: "Step 2",
    name: "Discovery & Scope Brief",
    pageId: "presession-brief",
    prototypeUrl: "/discovery-presession-brief.html",
    activeStages: ["VALUE_ALIGNMENT", "DISCOVERY_SCOPE"],
    doneStages: ["SOW_DELIVERED", "ACTIVE_ENGAGEMENT"],
    disabledReason: null,
  },
  {
    step: "Step 3",
    name: "SOW",
    pageId: null,
    prototypeUrl: null,
    activeStages: ["SOW_DELIVERED"],
    doneStages: ["ACTIVE_ENGAGEMENT"],
    disabledReason: "Delivered to Client / Not Yet placeholder in prototype",
  },
  {
    step: "Step 4",
    name: "KPI & Impact Tracker",
    pageId: "discovery-tool",
    prototypeUrl: "/discovery-tool.html",
    activeStages: ["ACTIVE_ENGAGEMENT"],
    doneStages: [],
    disabledReason: null,
  },
];

export const LAYERS: LayerDefinition[] = [
  {
    type: "CORE_PROBLEM",
    label: "Core Problem",
    description: "The immediate pain. The first SOW.",
  },
  {
    type: "OPTIMIZATION",
    label: "Optimization Opportunity",
    description: "AI intelligence on top of the fix.",
  },
  {
    type: "STRATEGIC_CONTROL",
    label: "Strategic Control",
    description: "The long-game capability that changes how they operate.",
  },
];

export const LAYER_STATUSES: LayerStatusDefinition[] = [
  { value: "IDENTIFIED", label: "Identified" },
  { value: "IN_DISCOVERY", label: "In Discovery" },
  { value: "QUALIFYING", label: "Qualifying" },
  { value: "READY_FOR_SOW", label: "Ready for SOW" },
  { value: "APPROVED", label: "Approved" },
  { value: "DEFERRED", label: "Deferred" },
];

export const OPPORTUNITY_TABS: OpportunityWorkspaceTab[] = [
  { index: 0, label: "Stage & Tools", minStage: null, lockedLabel: null },
  { index: 1, label: "Layers", minStage: null, lockedLabel: null },
  { index: 2, label: "Strategic Goals", minStage: null, lockedLabel: null },
  {
    index: 3,
    label: "Baseline Capture",
    minStage: "SOW_DELIVERED",
    lockedLabel: "Available after SOW is delivered",
  },
  {
    index: 4,
    label: "KPI Framework",
    minStage: "SOW_DELIVERED",
    lockedLabel: "Available after SOW is delivered",
  },
  { index: 5, label: "Use Case Scope", minStage: null, lockedLabel: null },
  {
    index: 6,
    label: "30/60/90 Check-ins",
    minStage: "ACTIVE_ENGAGEMENT",
    lockedLabel: "Available after engagement is active",
  },
  {
    index: 7,
    label: "Executive View",
    minStage: "ACTIVE_ENGAGEMENT",
    lockedLabel: "Available after engagement is active",
  },
];

export function stageIndex(stage: OpportunityStage): number {
  return STAGES.filter((item) => item.activePipelineStage).findIndex(
    (item) => item.value === stage,
  );
}
