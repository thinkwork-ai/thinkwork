export type SystemWorkflowRuntimeShape =
  | "STANDARD_PARENT"
  | "EXPRESS_CHILD"
  | "HYBRID";

export type SystemWorkflowStatus = "active" | "paused" | "archived";

export type SystemWorkflowConfigField = {
  key: string;
  label: string;
  description?: string;
  inputType: "boolean" | "number" | "string" | "select" | "json";
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
};

export type SystemWorkflowExtensionPoint = {
  id: string;
  label: string;
  description: string;
  hookType:
    | "pre_check"
    | "post_check"
    | "approval_gate"
    | "notification"
    | "validation";
  required: boolean;
};

export type SystemWorkflowEvidenceItem = {
  type: string;
  label: string;
  description: string;
  required: boolean;
};

export type SystemWorkflowStepManifestItem = {
  nodeId: string;
  label: string;
  stepType: string;
  runtime: "standard" | "express";
};

export type SystemWorkflowDefinition = {
  id: "wiki-build" | "evaluation-runs" | "tenant-agent-activation";
  name: string;
  description: string;
  category: "knowledge" | "quality" | "activation";
  owner: "ThinkWork";
  runtimeShape: SystemWorkflowRuntimeShape;
  status: SystemWorkflowStatus;
  activeVersion: string;
  configSchema: SystemWorkflowConfigField[];
  extensionPoints: SystemWorkflowExtensionPoint[];
  evidenceContract: SystemWorkflowEvidenceItem[];
  stepManifest: SystemWorkflowStepManifestItem[];
};
