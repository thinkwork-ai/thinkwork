import type { SystemWorkflowDefinition } from "./types.js";

export type SystemWorkflowDefinitionId = SystemWorkflowDefinition["id"];

export const SYSTEM_WORKFLOW_DEFINITIONS: SystemWorkflowDefinition[] = [
  {
    id: "wiki-build",
    name: "Wiki Build Process",
    description:
      "Compiles memory into durable wiki pages with checkpoints, quality gates, and rebuild approval support.",
    category: "knowledge",
    owner: "ThinkWork",
    runtimeShape: "HYBRID",
    status: "active",
    activeVersion: "2026-05-02.v1",
    configSchema: [
      {
        key: "destructiveRebuildRequiresApproval",
        label: "Require approval for destructive rebuilds",
        inputType: "boolean",
        required: true,
        defaultValue: true,
      },
      {
        key: "qualityGateThreshold",
        label: "Quality gate threshold",
        inputType: "number",
        required: true,
        defaultValue: 0.85,
      },
      {
        key: "plannerModel",
        label: "Planner model",
        inputType: "string",
        required: false,
      },
    ],
    extensionPoints: [
      {
        id: "pre-rebuild-approval",
        label: "Pre-rebuild approval",
        description: "Optional human approval before destructive rebuilds.",
        hookType: "approval_gate",
        required: false,
      },
      {
        id: "post-compile-validation",
        label: "Post-compile validation",
        description:
          "Tenant validation hook after pages and links are emitted.",
        hookType: "validation",
        required: false,
      },
    ],
    evidenceContract: [
      {
        type: "compile-summary",
        label: "Compile summary",
        description:
          "Compile job id, owner scope, page/link deltas, and final status.",
        required: true,
      },
      {
        type: "quality-gates",
        label: "Quality gates",
        description: "Planner/linking checks and threshold outcomes.",
        required: true,
      },
    ],
    stepManifest: [
      {
        nodeId: "ClaimCompileJob",
        label: "Claim compile job",
        stepType: "checkpoint",
        runtime: "standard",
      },
      {
        nodeId: "CompilePages",
        label: "Compile pages",
        stepType: "worker",
        runtime: "express",
      },
      {
        nodeId: "ValidateGraph",
        label: "Validate graph",
        stepType: "validation",
        runtime: "express",
      },
      {
        nodeId: "PublishEvidence",
        label: "Publish evidence",
        stepType: "evidence",
        runtime: "standard",
      },
    ],
  },
  {
    id: "evaluation-runs",
    name: "Evaluation Runs",
    description:
      "Coordinates test-pack snapshots, scorer batches, pass/fail gates, trace lookup, and evidence for agent evaluations.",
    category: "quality",
    owner: "ThinkWork",
    runtimeShape: "HYBRID",
    status: "active",
    activeVersion: "2026-05-02.v1",
    configSchema: [
      {
        key: "passRateThreshold",
        label: "Pass-rate threshold",
        inputType: "number",
        required: true,
        defaultValue: 0.9,
      },
      {
        key: "maxBatchSize",
        label: "Max test cases per batch",
        inputType: "number",
        required: true,
        defaultValue: 25,
      },
      {
        key: "preRunConnectorCheck",
        label: "Run connector readiness check",
        inputType: "boolean",
        required: true,
        defaultValue: true,
      },
    ],
    extensionPoints: [
      {
        id: "pre-run-check",
        label: "Pre-run check",
        description: "Optional tenant hook before evaluation batches start.",
        hookType: "pre_check",
        required: false,
      },
      {
        id: "failure-notification",
        label: "Failure notification",
        description: "Notification hook when a run fails threshold gates.",
        hookType: "notification",
        required: false,
      },
    ],
    evidenceContract: [
      {
        type: "test-pack-snapshot",
        label: "Test pack snapshot",
        description: "The tests and categories selected for this run.",
        required: true,
      },
      {
        type: "score-summary",
        label: "Score summary",
        description: "Evaluator outcomes, pass-rate gate, and cost summary.",
        required: true,
      },
    ],
    stepManifest: [
      {
        nodeId: "SnapshotTestPack",
        label: "Snapshot test pack",
        stepType: "checkpoint",
        runtime: "standard",
      },
      {
        nodeId: "RunBatches",
        label: "Run test batches",
        stepType: "worker",
        runtime: "express",
      },
      {
        nodeId: "AggregateScores",
        label: "Aggregate scores",
        stepType: "aggregation",
        runtime: "standard",
      },
      {
        nodeId: "ApplyPassFailGate",
        label: "Apply pass/fail gate",
        stepType: "gate",
        runtime: "standard",
      },
    ],
  },
  {
    id: "tenant-agent-activation",
    name: "Tenant/Agent Activation",
    description:
      "Tracks activation readiness, connector checks, policy attestations, apply work, and launch approval.",
    category: "activation",
    owner: "ThinkWork",
    runtimeShape: "STANDARD_PARENT",
    status: "active",
    activeVersion: "2026-05-02.v1",
    configSchema: [
      {
        key: "securityAttestationRequired",
        label: "Require security attestation",
        inputType: "boolean",
        required: true,
        defaultValue: true,
      },
      {
        key: "requiredConnectors",
        label: "Required connectors",
        inputType: "json",
        required: false,
        defaultValue: [],
      },
      {
        key: "launchApprovalRole",
        label: "Launch approval role",
        inputType: "select",
        required: true,
        defaultValue: "admin",
        options: ["admin", "owner"],
      },
    ],
    extensionPoints: [
      {
        id: "connector-readiness-check",
        label: "Connector readiness check",
        description: "Optional readiness hook before launch approval.",
        hookType: "pre_check",
        required: false,
      },
      {
        id: "security-attestation",
        label: "Security attestation",
        description: "Human attestation gate before activation launch.",
        hookType: "approval_gate",
        required: false,
      },
    ],
    evidenceContract: [
      {
        type: "activation-timeline",
        label: "Activation timeline",
        description: "Layer progress, checkpoints, and apply outcomes.",
        required: true,
      },
      {
        type: "launch-approval",
        label: "Launch approval",
        description: "Approval and attestation decisions for launch.",
        required: true,
      },
    ],
    stepManifest: [
      {
        nodeId: "TrackReadiness",
        label: "Track readiness",
        stepType: "checkpoint",
        runtime: "standard",
      },
      {
        nodeId: "RunPolicyChecks",
        label: "Run policy checks",
        stepType: "validation",
        runtime: "standard",
      },
      {
        nodeId: "ApplyActivationBundle",
        label: "Apply activation bundle",
        stepType: "worker",
        runtime: "standard",
      },
      {
        nodeId: "RecordLaunchDecision",
        label: "Record launch decision",
        stepType: "evidence",
        runtime: "standard",
      },
    ],
  },
];

export function listSystemWorkflowDefinitions(): SystemWorkflowDefinition[] {
  return SYSTEM_WORKFLOW_DEFINITIONS;
}

export function getSystemWorkflowDefinition(
  id: string,
): SystemWorkflowDefinition | null {
  return (
    SYSTEM_WORKFLOW_DEFINITIONS.find((definition) => definition.id === id) ??
    null
  );
}

export function defaultSystemWorkflowConfig(
  definition: SystemWorkflowDefinition,
): Record<string, unknown> {
  return Object.fromEntries(
    definition.configSchema
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]),
  );
}
