export const SPACE_WRITEBACK_POLICIES = [
  "disabled",
  "status_only",
  "status_and_comments",
] as const;

export type SpaceWritebackPolicy = (typeof SPACE_WRITEBACK_POLICIES)[number];

export type ExternalTaskWritebackAction =
  | "status_summary"
  | "human_comment"
  | "agent_comment";

export interface SpaceWritebackPolicyConfig {
  allowAgentComments?: boolean;
  agentCommentMode?: "disabled" | "requires_confirmation" | "allowed";
}

export interface EvaluateExternalTaskWritebackInput {
  policy?: SpaceWritebackPolicy | string | null;
  action: ExternalTaskWritebackAction;
  humanConfirmed?: boolean;
  config?: SpaceWritebackPolicyConfig | null;
}

export interface ExternalTaskWritebackDecision {
  allowed: boolean;
  policy: SpaceWritebackPolicy;
  reason:
    | "allowed"
    | "writeback_disabled"
    | "comments_disabled"
    | "agent_comment_confirmation_required"
    | "agent_comments_disabled";
  requiresHumanConfirmation: boolean;
}

export function normalizeSpaceWritebackPolicy(
  value: SpaceWritebackPolicy | string | null | undefined,
): SpaceWritebackPolicy {
  if (typeof value !== "string") return "disabled";
  const normalized = value.trim().toLowerCase();
  return SPACE_WRITEBACK_POLICIES.includes(normalized as SpaceWritebackPolicy)
    ? (normalized as SpaceWritebackPolicy)
    : "disabled";
}

export function evaluateExternalTaskWriteback(
  input: EvaluateExternalTaskWritebackInput,
): ExternalTaskWritebackDecision {
  const policy = normalizeSpaceWritebackPolicy(input.policy);
  if (policy === "disabled") {
    return deny(policy, "writeback_disabled", false);
  }

  if (input.action === "status_summary") {
    return allow(policy);
  }

  if (policy === "status_only") {
    return deny(policy, "comments_disabled", false);
  }

  if (input.action === "human_comment") {
    return allow(policy);
  }

  const agentCommentMode =
    input.config?.agentCommentMode ??
    (input.config?.allowAgentComments ? "allowed" : "requires_confirmation");
  if (agentCommentMode === "disabled") {
    return deny(policy, "agent_comments_disabled", false);
  }
  if (agentCommentMode === "allowed" || input.humanConfirmed === true) {
    return allow(policy);
  }
  return deny(policy, "agent_comment_confirmation_required", true);
}

function allow(policy: SpaceWritebackPolicy): ExternalTaskWritebackDecision {
  return {
    allowed: true,
    policy,
    reason: "allowed",
    requiresHumanConfirmation: false,
  };
}

function deny(
  policy: SpaceWritebackPolicy,
  reason: ExternalTaskWritebackDecision["reason"],
  requiresHumanConfirmation: boolean,
): ExternalTaskWritebackDecision {
  return {
    allowed: false,
    policy,
    reason,
    requiresHumanConfirmation,
  };
}
